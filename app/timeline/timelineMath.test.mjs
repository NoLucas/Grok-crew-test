// Focused unit tests for the P1-01 timeline editor's pure logic.
//
// Plain ESM (.mjs) on purpose: it imports the .ts sources directly with
// their real extension, which Node's built-in type-stripping loader
// requires but tsconfig.json rejects for a .ts *importer* (TS5097, since
// this repo does not set allowImportingTsExtensions — out of scope for
// P1-01 to change). A .mjs file is outside tsconfig.json's "include" globs
// and nothing else imports it, so `tsc --noEmit` never looks at it.
//
// Run with:
//   node --experimental-strip-types --test app/timeline/timelineMath.test.mjs
// (the flag is redundant but harmless on Node >=22.18 / >=23.6, where type
// stripping is unflagged; it is required on Node 22.13-22.17, the floor set
// by package.json's "engines".)

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPatchBody,
  clampInsideClip,
  clampRollBoundary,
  clampSlideStart,
  clipEnd,
  collectSnapPoints,
  frameSeconds,
  isClipLocked,
  moveClipOp,
  rippleTrimOp,
  rollEditOp,
  round3,
  slideClipOp,
  slipClipOp,
  snapTime,
  splitClipOp,
  timelineDuration,
  trimClipOp,
} from './timelineMath.ts';
import { classifyPatchError, TimelinePatchClientError } from './timelineTypes.ts';

function clip(overrides = {}) {
  return { id: 'clip-1', timeline_start: 0, duration: 4, locked: false, ...overrides };
}

test('round3 rounds to millisecond precision', () => {
  assert.equal(round3(1.23456), 1.235);
  assert.equal(round3(-0.0001), -0);
});

test('clipEnd sums start and duration', () => {
  assert.equal(clipEnd(clip({ timeline_start: 2, duration: 3 })), 5);
});

test('timelineDuration returns the minimum floor when the timeline is empty', () => {
  assert.equal(timelineDuration({ tracks: [] }, 10), 10);
});

test('timelineDuration returns the furthest clip end across tracks', () => {
  const timeline = {
    tracks: [
      { clips: [clip({ id: 'a', timeline_start: 0, duration: 4 })] },
      { clips: [clip({ id: 'b', timeline_start: 20, duration: 5 })] },
    ],
  };
  assert.equal(timelineDuration(timeline, 10), 25);
});

test('isClipLocked is true if either the track or the clip is locked', () => {
  assert.equal(isClipLocked({ locked: false }, clip({ locked: false })), false);
  assert.equal(isClipLocked({ locked: true }, clip({ locked: false })), true);
  assert.equal(isClipLocked({ locked: false }, clip({ locked: true })), true);
});

test('collectSnapPoints gathers every clip edge plus 0 and the playhead, deduplicated and sorted', () => {
  const timeline = {
    tracks: [
      { clips: [clip({ id: 'a', timeline_start: 0, duration: 4 }), clip({ id: 'b', timeline_start: 4, duration: 2 })] },
    ],
  };
  const points = collectSnapPoints(timeline, { playhead: 10 });
  assert.deepEqual(points, [0, 4, 6, 10]);
});

test('collectSnapPoints excludes the clip currently being dragged', () => {
  const timeline = {
    tracks: [{ clips: [clip({ id: 'a', timeline_start: 0, duration: 4 }), clip({ id: 'b', timeline_start: 4, duration: 2 })] }],
  };
  const points = collectSnapPoints(timeline, { excludeClipIds: new Set(['b']) });
  assert.deepEqual(points, [0, 4]);
});

test('snapTime snaps to the nearest candidate within the pixel threshold', () => {
  const result = snapTime(4.05, [0, 4, 6], 60, 8);
  assert.equal(result.snapped, true);
  assert.equal(result.value, 4);
});

test('snapTime leaves the value untouched when nothing is close enough', () => {
  const result = snapTime(5, [0, 4, 6], 60, 8);
  assert.equal(result.snapped, false);
  assert.equal(result.value, 5);
});

test('clampInsideClip keeps a trim/split point strictly inside the clip', () => {
  const c = clip({ timeline_start: 2, duration: 4 }); // spans 2..6
  assert.equal(clampInsideClip(c, 0), 2.001);
  assert.equal(clampInsideClip(c, 10), 5.999);
  assert.equal(clampInsideClip(c, 4), 4);
});

test('clampRollBoundary keeps the shared edge inside the combined span', () => {
  const left = clip({ timeline_start: 0, duration: 4 }); // 0..4
  const right = clip({ timeline_start: 4, duration: 3 }); // 4..7
  assert.equal(clampRollBoundary(left, right, -5), 0.001);
  assert.equal(clampRollBoundary(left, right, 50), 6.999);
  assert.equal(clampRollBoundary(left, right, 5), 5);
});

test('clampSlideStart keeps both neighbors longer than zero', () => {
  const previous = clip({ id: 'p', timeline_start: 0, duration: 4 }); // 0..4
  const selected = clip({ id: 's', timeline_start: 4, duration: 2 }); // 4..6
  const following = clip({ id: 'f', timeline_start: 6, duration: 5 }); // 6..11
  // min = previous.start + EPS = 0.001; max = clipEnd(following) - selected.duration - EPS = 11 - 2 - 0.001 = 8.999
  assert.equal(clampSlideStart(previous, selected, following, -5), 0.001);
  assert.equal(clampSlideStart(previous, selected, following, 50), 8.999);
  assert.equal(clampSlideStart(previous, selected, following, 5), 5);
});

test('frameSeconds converts fps to a per-frame duration, defaulting to 30fps', () => {
  assert.equal(frameSeconds(30), 1 / 30);
  assert.equal(frameSeconds(0), 1 / 30);
});

test('patch operation builders match local_studio/schemas/timeline-patch-v1.schema.json required fields', () => {
  assert.deepEqual(moveClipOp('c1', 1.23456), { op: 'move_clip', clip_id: 'c1', timeline_start: 1.235 });
  assert.deepEqual(moveClipOp('c1', 1, 'track-2'), { op: 'move_clip', clip_id: 'c1', timeline_start: 1, track_id: 'track-2' });
  assert.deepEqual(trimClipOp('c1', 'start', 2), { op: 'trim_clip', clip_id: 'c1', edge: 'start', at: 2 });
  assert.deepEqual(splitClipOp('c1', 2), { op: 'split_clip', clip_id: 'c1', at: 2 });
  assert.deepEqual(splitClipOp('c1', 2, 'c1-a', 'c1-b'), { op: 'split_clip', clip_id: 'c1', at: 2, left_id: 'c1-a', right_id: 'c1-b' });
  // ripple_trim's schema requires edge to be the literal "end".
  assert.deepEqual(rippleTrimOp('c1', 3), { op: 'ripple_trim', clip_id: 'c1', edge: 'end', at: 3 });
  assert.deepEqual(rollEditOp('left', 'right', 5), { op: 'roll_edit', left_clip_id: 'left', right_clip_id: 'right', at: 5 });
  assert.deepEqual(slipClipOp('c1', 1), { op: 'slip_clip', clip_id: 'c1', source_in: 1 });
  assert.deepEqual(slideClipOp('p', 's', 'n', 4), { op: 'slide_clip', previous_clip_id: 'p', clip_id: 's', next_clip_id: 'n', timeline_start: 4 });
});

test('buildPatchBody wraps operations with the required patch envelope', () => {
  const body = buildPatchBody(3, [moveClipOp('c1', 1)], 'operator');
  assert.equal(body.schema, 'grok-crew.timeline-patch/v1');
  assert.equal(body.base_revision, 3);
  assert.equal(body.origin, 'human');
  assert.equal(body.created_by, 'operator');
  assert.equal(body.operations.length, 1);
});

test('classifyPatchError maps stable backend error codes to UI-facing kinds', () => {
  const locked = new TimelinePatchClientError({ code: 'timeline_item_locked', message: 'locked', details: {} }, 400);
  const stale = new TimelinePatchClientError({ code: 'stale_timeline_revision', message: 'stale', details: { expected_revision: 2, received_revision: 1 } }, 409);
  const notFound = new TimelinePatchClientError({ code: 'timeline_item_not_found', message: 'missing', details: {} }, 400);
  const transport = new TimelinePatchClientError({ code: 'timeline_patch_transport_error', message: 'offline', details: {} }, 0);
  const other = new TimelinePatchClientError({ code: 'invalid_time_range', message: 'bad range', details: {} }, 400);

  assert.equal(classifyPatchError(locked).kind, 'locked');
  assert.equal(classifyPatchError(stale).kind, 'stale');
  assert.equal(classifyPatchError(notFound).kind, 'not_found');
  assert.equal(classifyPatchError(transport).kind, 'transport');
  assert.equal(classifyPatchError(other).kind, 'validation');
  assert.equal(classifyPatchError(new Error('plain')).kind, 'unknown');
});
