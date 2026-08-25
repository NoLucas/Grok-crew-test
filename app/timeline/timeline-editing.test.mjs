// Focused tests for the P1-01 timeline editing pure layer.
//
// Run with:  node --test app/timeline/timeline-editing.test.mjs
//
// Everything under test is pure: operation builders, error presentation, patch
// result normalisation and drag preview geometry. The React components are
// verified by hand following docs in the handoff.

import assert from 'node:assert/strict';
import { register } from 'node:module';
import { describe, it } from 'node:test';

register('./ts-resolver.helper.mjs', import.meta.url);

const {
  TIMELINE_PATCH_SCHEMA,
  buildMoveOperation,
  buildRippleOperation,
  buildRollOperation,
  buildSlideOperation,
  buildSlipOperation,
  buildSplitOperation,
  buildTimelinePatch,
  buildTrimOperation,
  clampSlideStart,
  clampSlipSourceIn,
  clampTrimEdge,
  isEditable,
  splitIdentifiers,
} = await import('./operations.ts');
const { presentEditBlock, presentTimelineError } = await import('./errors.ts');
const { normalizeTimelinePatchResult, sendTimelinePatch } = await import('./patch-client.ts');
const { previewRect } = await import('./preview.ts');
const { adjacentNeighbours, findClip, timelineDuration } = await import('./geometry.ts');

const LONG_NAME = 'Ridiculously long interview clip name that must never break the lane layout';

function fixture() {
  return {
    schema: 'grok-crew.timeline/v2',
    revision: 4,
    settings: { width: 1080, height: 1920, fps: 30, quality: 'balanced' },
    assets: [{ id: 'asset-1', kind: 'video', name: LONG_NAME, duration: 30 }],
    tracks: [
      {
        id: 'v1', type: 'video', name: 'Main', order: 0, locked: false, muted: false,
        clips: [
          { id: 'clip-a', asset_id: 'asset-1', timeline_start: 0, duration: 4, source_in: 0, source_out: 4, locked: false },
          { id: 'clip-b', asset_id: 'asset-1', timeline_start: 4, duration: 4, source_in: 10, source_out: 14, locked: false },
          { id: 'clip-c', asset_id: 'asset-1', timeline_start: 8, duration: 4, source_in: 20, source_out: 24, locked: false },
        ],
      },
      { id: 'v2', type: 'video', name: 'B-roll', order: 10, locked: false, muted: false, clips: [] },
      {
        id: 'v3', type: 'video', name: 'Locked track', order: 20, locked: true, muted: false,
        clips: [{ id: 'clip-on-locked-track', timeline_start: 0, duration: 2, locked: false }],
      },
      {
        id: 'a1', type: 'audio', name: 'Voice', order: 30, locked: false, muted: false,
        clips: [{ id: 'clip-locked', timeline_start: 0, duration: 6, locked: true }],
      },
    ],
    markers: [],
  };
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const at = (timeline, clipId) => findClip(timeline, clipId);

describe('operation builders produce the frozen contract shape', () => {
  it('move stays on one track unless a target is named', () => {
    const timeline = deepFreeze(fixture());
    const { track, clip } = at(timeline, 'clip-b');
    const same = buildMoveOperation(track, clip, 5.25);
    assert.equal(same.ok, true);
    assert.deepEqual(same.value, { op: 'move_clip', clip_id: 'clip-b', timeline_start: 5.25 });

    const target = timeline.tracks.find((item) => item.id === 'v2');
    const across = buildMoveOperation(track, clip, 2, target);
    assert.equal(across.ok, true);
    assert.deepEqual(across.value, { op: 'move_clip', clip_id: 'clip-b', timeline_start: 2, track_id: 'v2' });
  });

  it('move refuses a different track kind and a locked destination', () => {
    const timeline = deepFreeze(fixture());
    const { track, clip } = at(timeline, 'clip-b');
    const audio = timeline.tracks.find((item) => item.id === 'a1');
    assert.equal(buildMoveOperation(track, clip, 1, audio).block.code, 'invalid_operation');
    const lockedTrack = timeline.tracks.find((item) => item.id === 'v3');
    assert.equal(buildMoveOperation(track, clip, 1, lockedTrack).block.code, 'timeline_item_locked');
  });

  it('trim carries the edge and the absolute timeline point', () => {
    const timeline = deepFreeze(fixture());
    const { track, clip } = at(timeline, 'clip-b');
    assert.deepEqual(
      buildTrimOperation(timeline, track, clip, 'start', 5).value,
      { op: 'trim_clip', clip_id: 'clip-b', edge: 'start', at: 5 },
    );
    assert.deepEqual(
      buildTrimOperation(timeline, track, clip, 'end', 7).value,
      { op: 'trim_clip', clip_id: 'clip-b', edge: 'end', at: 7 },
    );
  });

  it('trim rejects a point that is not strictly inside the clip', () => {
    const timeline = deepFreeze(fixture());
    const { track, clip } = at(timeline, 'clip-b');
    assert.equal(buildTrimOperation(timeline, track, clip, 'start', 4).block.code, 'invalid_time_range');
    assert.equal(buildTrimOperation(timeline, track, clip, 'end', 8).block.code, 'invalid_time_range');
    assert.equal(buildTrimOperation(timeline, track, clip, 'end', 20).block.code, 'invalid_time_range');
  });

  it('trim only ever shortens a clip, matching _apply_trim', () => {
    const timeline = deepFreeze(fixture());
    const { track, clip } = at(timeline, 'clip-c');
    assert.equal(buildTrimOperation(timeline, track, clip, 'end', 11).ok, true);
    // Past the clip's own edge is not a longer clip, it is an invalid range.
    assert.equal(buildTrimOperation(timeline, track, clip, 'end', 19).block.code, 'invalid_time_range');
    assert.equal(buildTrimOperation(timeline, track, clip, 'start', 2).block.code, 'invalid_time_range');
    // The drag clamp therefore never leaves the clip in either direction.
    assert.ok(clampTrimEdge(clip, 'start', -50) > clip.timeline_start);
    assert.ok(clampTrimEdge(clip, 'end', 500) < clip.timeline_start + clip.duration);
  });

  it('roll keeps the widened side inside its asset at 1x playback', () => {
    // left plays source 2..5 of a 6s asset, so the seam may only move 1s right.
    const timeline = deepFreeze({
      schema: 'grok-crew.timeline/v2', revision: 1,
      settings: { width: 1080, height: 1920, fps: 30, quality: 'balanced' },
      assets: [{ id: 'short', kind: 'video', name: 'Short take', duration: 6 }],
      tracks: [{
        id: 'v1', type: 'video', name: 'Main', order: 0, locked: false, muted: false,
        clips: [
          { id: 'left', asset_id: 'short', timeline_start: 0, duration: 3, source_in: 2, source_out: 5, locked: false },
          { id: 'right', asset_id: 'short', timeline_start: 3, duration: 2, source_in: 0, source_out: 2, locked: false },
        ],
      }],
      markers: [],
    });
    const track = timeline.tracks[0];
    const [left, right] = track.clips;
    assert.equal(buildRollOperation(timeline, track, left, right, 3.5).ok, true);
    const beyond = buildRollOperation(timeline, track, left, right, 4.5);
    assert.equal(beyond.ok, false);
    assert.equal(beyond.block.code, 'source_range_exceeds_asset');
  });

  it('split names both halves with contract-safe unique ids', () => {
    const timeline = deepFreeze(fixture());
    const { track, clip } = at(timeline, 'clip-b');
    const result = buildSplitOperation(timeline, track, clip, 6);
    assert.equal(result.ok, true);
    assert.equal(result.value.op, 'split_clip');
    assert.equal(result.value.clip_id, 'clip-b');
    assert.equal(result.value.at, 6);
    assert.match(result.value.left_id, /^[A-Za-z0-9\-_.]+$/);
    assert.match(result.value.right_id, /^[A-Za-z0-9\-_.]+$/);
    assert.notEqual(result.value.left_id, result.value.right_id);
    assert.equal(buildSplitOperation(timeline, track, clip, 4).block.code, 'invalid_time_range');
  });

  it('split ids avoid names already used elsewhere in the timeline', () => {
    const timeline = fixture();
    const first = splitIdentifiers(timeline, timeline.tracks[0].clips[1]);
    timeline.tracks[1].clips.push({ id: first.left_id, timeline_start: 0, duration: 1, locked: false });
    const second = splitIdentifiers(deepFreeze(timeline), timeline.tracks[0].clips[1]);
    assert.notEqual(second.left_id, first.left_id);
  });

  it('split sanitises ids that would break the identifier rule', () => {
    const timeline = fixture();
    timeline.tracks[0].clips[0].id = 'clip a/b:c';
    const ids = splitIdentifiers(deepFreeze(timeline), timeline.tracks[0].clips[0]);
    assert.match(ids.left_id, /^[A-Za-z0-9\-_.]+$/);
    assert.match(ids.right_id, /^[A-Za-z0-9\-_.]+$/);
  });

  it('ripple trim is end-only and refuses to shift a locked follower', () => {
    const timeline = fixture();
    const track = timeline.tracks[0];
    const ok = buildRippleOperation(deepFreeze(structuredClone(timeline)), track, track.clips[0], 3);
    assert.deepEqual(ok.value, { op: 'ripple_trim', clip_id: 'clip-a', edge: 'end', at: 3 });

    timeline.tracks[0].clips[2].locked = true;
    const blockedByFollower = buildRippleOperation(deepFreeze(timeline), timeline.tracks[0], timeline.tracks[0].clips[0], 3);
    assert.equal(blockedByFollower.ok, false);
    assert.equal(blockedByFollower.block.code, 'timeline_item_locked');
    assert.equal(blockedByFollower.block.details.clip_id, 'clip-c');
  });

  it('roll names both clips and requires them to touch on one track', () => {
    const timeline = deepFreeze(fixture());
    const track = timeline.tracks[0];
    const [a, b, c] = track.clips;
    assert.deepEqual(
      buildRollOperation(timeline, track, a, b, 3).value,
      { op: 'roll_edit', left_clip_id: 'clip-a', right_clip_id: 'clip-b', at: 3 },
    );
    assert.equal(buildRollOperation(timeline, track, a, c, 3).block.code, 'clips_not_adjacent');
    assert.equal(buildRollOperation(timeline, track, a, b, 0).block.code, 'invalid_time_range');
    assert.equal(buildRollOperation(timeline, track, a, b, 8).block.code, 'invalid_time_range');
  });

  it('slip only moves the source window and stays inside the asset', () => {
    const timeline = deepFreeze(fixture());
    const { track, clip } = at(timeline, 'clip-b');
    assert.deepEqual(
      buildSlipOperation(timeline, track, clip, 12).value,
      { op: 'slip_clip', clip_id: 'clip-b', source_in: 12 },
    );
    // Source window is 4s long inside a 30s asset, so 26 is the last valid start.
    assert.equal(buildSlipOperation(timeline, track, clip, 26).ok, true);
    assert.equal(buildSlipOperation(timeline, track, clip, 27).block.code, 'source_range_exceeds_asset');
    assert.equal(buildSlipOperation(timeline, track, clip, -1).block.code, 'invalid_time_range');
  });

  it('slip refuses a clip that carries no source range', () => {
    const timeline = deepFreeze(fixture());
    const track = timeline.tracks.find((item) => item.id === 'v3');
    const result = buildSlipOperation(timeline, { ...track, locked: false }, track.clips[0], 2);
    assert.equal(result.ok, false);
    assert.equal(result.block.code, 'invalid_source_range');
  });

  it('slide names the touching previous and next clips', () => {
    const timeline = deepFreeze(fixture());
    const { track, clip } = at(timeline, 'clip-b');
    assert.deepEqual(
      buildSlideOperation(timeline, track, clip, 5).value,
      { op: 'slide_clip', previous_clip_id: 'clip-a', clip_id: 'clip-b', next_clip_id: 'clip-c', timeline_start: 5 },
    );
  });

  it('slide needs both neighbours and must keep them longer than zero', () => {
    const timeline = deepFreeze(fixture());
    const edge = at(timeline, 'clip-a');
    assert.equal(buildSlideOperation(timeline, edge.track, edge.clip, 1).block.code, 'clips_not_adjacent');

    const middle = at(timeline, 'clip-b');
    assert.equal(buildSlideOperation(timeline, middle.track, middle.clip, 0).block.code, 'invalid_time_range');
    assert.equal(buildSlideOperation(timeline, middle.track, middle.clip, 8).block.code, 'invalid_time_range');
  });

  it('every builder refuses a locked clip and a locked track', () => {
    const timeline = deepFreeze(fixture());
    const lockedClip = at(timeline, 'clip-locked');
    const onLockedTrack = at(timeline, 'clip-on-locked-track');
    for (const { track, clip } of [lockedClip, onLockedTrack]) {
      assert.equal(buildMoveOperation(track, clip, 1).block.code, 'timeline_item_locked');
      assert.equal(buildTrimOperation(timeline, track, clip, 'end', 1).block.code, 'timeline_item_locked');
      assert.equal(buildSplitOperation(timeline, track, clip, 1).block.code, 'timeline_item_locked');
      assert.equal(buildRippleOperation(timeline, track, clip, 1).block.code, 'timeline_item_locked');
      assert.equal(buildSlipOperation(timeline, track, clip, 1).block.code, 'timeline_item_locked');
      assert.equal(isEditable(track, clip), false);
    }
  });

  it('builders never mutate the timeline they were given', () => {
    const timeline = deepFreeze(fixture());
    const { track, clip } = at(timeline, 'clip-b');
    buildMoveOperation(track, clip, 9);
    buildTrimOperation(timeline, track, clip, 'end', 7);
    buildSplitOperation(timeline, track, clip, 6);
    buildRippleOperation(timeline, track, clip, 7);
    buildSlipOperation(timeline, track, clip, 12);
    buildSlideOperation(timeline, track, clip, 5);
    assert.equal(clip.timeline_start, 4);
    assert.equal(clip.duration, 4);
    assert.equal(timeline.revision, 4);
  });
});

describe('patch envelope', () => {
  it('matches grok-crew.timeline-patch/v1 with a human origin', () => {
    const patch = buildTimelinePatch(7, 'operator', [{ op: 'move_clip', clip_id: 'clip-a', timeline_start: 1 }]);
    assert.deepEqual(patch, {
      schema: TIMELINE_PATCH_SCHEMA,
      base_revision: 7,
      origin: 'human',
      created_by: 'operator',
      operations: [{ op: 'move_clip', clip_id: 'clip-a', timeline_start: 1 }],
    });
    assert.equal(patch.schema, 'grok-crew.timeline-patch/v1');
  });
});

describe('drag clamps keep the preview inside what the sidecar accepts', () => {
  it('clamps a trim to stay inside the clip', () => {
    const clip = { id: 'x', timeline_start: 4, duration: 4, locked: false };
    for (const edge of ['start', 'end']) {
      assert.ok(clampTrimEdge(clip, edge, -10) > 4, edge);
      assert.ok(clampTrimEdge(clip, edge, 99) < 8, edge);
    }
  });

  it('clamps a slip to the asset window', () => {
    const timeline = deepFreeze(fixture());
    const { clip } = at(timeline, 'clip-b');
    assert.equal(clampSlipSourceIn(timeline, clip, -8), 0);
    assert.equal(clampSlipSourceIn(timeline, clip, 999), 26);
  });

  it('clamps a slide so neither neighbour collapses', () => {
    const timeline = deepFreeze(fixture());
    const track = timeline.tracks[0];
    const [previous, clip, next] = track.clips;
    assert.ok(clampSlideStart(previous, clip, next, -99) > 0);
    assert.ok(clampSlideStart(previous, clip, next, 99) < 8);
  });
});

describe('error presentation', () => {
  const required = [
    'stale_timeline_revision',
    'timeline_item_locked',
    'invalid_time_range',
    'invalid_source_range',
    'source_range_exceeds_asset',
    'clips_not_adjacent',
    'clips_on_different_tracks',
    'timeline_item_not_found',
    'invalid_operation',
    'timeline_patch_transport_error',
  ];

  it('covers every required code in all four languages', () => {
    for (const code of required) {
      const shown = presentTimelineError({ code, message: code, details: {} });
      assert.equal(shown.code, code);
      for (const language of ['ko', 'en', 'zh', 'ja']) {
        assert.ok(shown.title[language].length > 0, `${code} title.${language}`);
        assert.ok(shown.detail[language].length > 0, `${code} detail.${language}`);
        assert.ok(!shown.title[language].includes(code), `${code} must not leak its raw code`);
      }
    }
  });

  it('routes each failure to the right recovery', () => {
    const recovery = (code, details = {}) => presentTimelineError({ code, message: code, details }).recovery;
    assert.equal(recovery('stale_timeline_revision', { expected_revision: 9 }), 'reload_timeline');
    assert.equal(recovery('timeline_item_not_found'), 'reload_timeline');
    assert.equal(recovery('timeline_patch_transport_error'), 'retry');
    assert.equal(recovery('timeline_item_locked'), 'keep_revision');
    assert.equal(recovery('invalid_time_range'), 'keep_revision');
    assert.equal(recovery('clips_not_adjacent'), 'keep_revision');
  });

  it('uses distinct tones so the strip can be read at a glance', () => {
    const tone = (code) => presentTimelineError({ code, message: code, details: {} }).tone;
    assert.equal(tone('timeline_item_locked'), 'locked');
    assert.equal(tone('stale_timeline_revision'), 'stale');
    assert.equal(tone('timeline_patch_transport_error'), 'offline');
    assert.equal(tone('invalid_source_range'), 'invalid');
  });

  it('mentions the revision the sidecar expects on a stale patch', () => {
    const shown = presentTimelineError({
      code: 'stale_timeline_revision', message: 'stale', details: { expected_revision: 12, received_revision: 11 },
    });
    assert.match(shown.detail.ko, /v12/);
    assert.match(shown.detail.en, /v12/);
  });

  it('falls back safely for a code it has never seen', () => {
    const shown = presentTimelineError({ code: 'brand_new_code', message: 'x', details: {} });
    assert.equal(shown.recovery, 'keep_revision');
    assert.ok(shown.title.ko.length > 0);
  });

  it('shows locally blocked edits with the same wording as the sidecar', () => {
    const timeline = deepFreeze(fixture());
    const { track, clip } = at(timeline, 'clip-locked');
    const built = buildMoveOperation(track, clip, 1);
    assert.equal(built.ok, false);
    assert.deepEqual(
      presentEditBlock(built.block).title,
      presentTimelineError({ code: 'timeline_item_locked', message: '', details: {} }).title,
    );
  });
});

describe('patch result normalisation', () => {
  const timeline = fixture();
  const version = { id: 'v-1', revision: 5, origin: 'human', created_by: 'operator', created_at: 'now' };

  it('accepts the documented success envelope', () => {
    const outcome = normalizeTimelinePatchResult({ ok: true, status: 201, value: { version, timeline } });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.status, 201);
    assert.equal(outcome.value.timeline.revision, 4);
    assert.equal(outcome.value.version.revision, 5);
  });

  it('keeps the code, message and details of a failure', () => {
    const outcome = normalizeTimelinePatchResult({
      ok: false, status: 409,
      error: { code: 'stale_timeline_revision', message: 'stale', details: { expected_revision: 5 } },
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.status, 409);
    assert.equal(outcome.error.code, 'stale_timeline_revision');
    assert.deepEqual(outcome.error.details, { expected_revision: 5 });
  });

  it('treats a malformed or empty reply as a transport failure', () => {
    for (const raw of [null, undefined, 'nope', {}, { ok: true }, { ok: true, value: {} }, { ok: true, value: { timeline: {} } }]) {
      const outcome = normalizeTimelinePatchResult(raw);
      assert.equal(outcome.ok, false, JSON.stringify(raw));
      assert.equal(outcome.error.code, 'timeline_patch_transport_error');
    }
  });

  it('names an unlabelled failure instead of showing nothing', () => {
    const outcome = normalizeTimelinePatchResult({ ok: false, status: 500, error: {} });
    assert.equal(outcome.error.code, 'timeline_patch_failed');
    assert.ok(outcome.error.message.length > 0);
  });

  it('reports a missing desktop bridge as a transport failure', async () => {
    const outcome = await sendTimelinePatch(undefined, 'p1', buildTimelinePatch(1, 'operator', []));
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error.code, 'timeline_patch_transport_error');
  });

  it('never lets a throwing bridge escape to the UI', async () => {
    const outcome = await sendTimelinePatch(async () => { throw new Error('ipc down'); }, 'p1', buildTimelinePatch(1, 'operator', []));
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error.code, 'timeline_patch_transport_error');
  });

  it('passes the project id and patch straight through to the bridge', async () => {
    const seen = [];
    const patch = buildTimelinePatch(3, 'operator', [{ op: 'move_clip', clip_id: 'clip-a', timeline_start: 2 }]);
    await sendTimelinePatch(async (projectId, sent) => {
      seen.push([projectId, sent]);
      return { ok: true, status: 201, value: { version, timeline } };
    }, 'project-9', patch);
    assert.deepEqual(seen, [['project-9', patch]]);
  });
});

describe('drag preview geometry', () => {
  it('moves only the dragged clip', () => {
    const timeline = deepFreeze(fixture());
    const track = timeline.tracks[0];
    const preview = { kind: 'move', clipId: 'clip-b', fromTrackId: 'v1', toTrackId: 'v1', timelineStart: 6 };
    assert.deepEqual(previewRect(preview, track, track.clips[1]), { timeline_start: 6, duration: 4 });
    assert.deepEqual(previewRect(preview, track, track.clips[2]), { timeline_start: 8, duration: 4 });
  });

  it('shows a ripple pulling the later clips along', () => {
    const timeline = deepFreeze(fixture());
    const track = timeline.tracks[0];
    const preview = { kind: 'ripple', clipId: 'clip-a', at: 3 };
    assert.deepEqual(previewRect(preview, track, track.clips[0]), { timeline_start: 0, duration: 3 });
    assert.deepEqual(previewRect(preview, track, track.clips[1]), { timeline_start: 3, duration: 4 });
    assert.deepEqual(previewRect(preview, track, track.clips[2]), { timeline_start: 7, duration: 4 });
  });

  it('shows a roll trading length between the two clips only', () => {
    const timeline = deepFreeze(fixture());
    const track = timeline.tracks[0];
    const preview = { kind: 'roll', leftClipId: 'clip-a', rightClipId: 'clip-b', at: 3 };
    assert.deepEqual(previewRect(preview, track, track.clips[0]), { timeline_start: 0, duration: 3 });
    assert.deepEqual(previewRect(preview, track, track.clips[1]), { timeline_start: 3, duration: 5 });
    assert.deepEqual(previewRect(preview, track, track.clips[2]), { timeline_start: 8, duration: 4 });
  });

  it('shows a slide trading length between both neighbours', () => {
    const timeline = deepFreeze(fixture());
    const track = timeline.tracks[0];
    const preview = { kind: 'slide', clipId: 'clip-b', previousClipId: 'clip-a', nextClipId: 'clip-c', timelineStart: 5 };
    assert.deepEqual(previewRect(preview, track, track.clips[0]), { timeline_start: 0, duration: 5 });
    assert.deepEqual(previewRect(preview, track, track.clips[1]), { timeline_start: 5, duration: 4 });
    assert.deepEqual(previewRect(preview, track, track.clips[2]), { timeline_start: 9, duration: 3 });
  });

  it('leaves the rectangle alone while slipping', () => {
    const timeline = deepFreeze(fixture());
    const track = timeline.tracks[0];
    const preview = { kind: 'slip', clipId: 'clip-b', sourceIn: 12, delta: 2 };
    assert.deepEqual(previewRect(preview, track, track.clips[1]), { timeline_start: 4, duration: 4 });
  });

  it('reports no preview as the committed rectangle', () => {
    const timeline = deepFreeze(fixture());
    const track = timeline.tracks[0];
    assert.deepEqual(previewRect(null, track, track.clips[1]), { timeline_start: 4, duration: 4 });
  });
});

describe('lane helpers', () => {
  it('finds only neighbours that touch exactly', () => {
    const timeline = fixture();
    const track = timeline.tracks[0];
    assert.deepEqual(
      Object.entries(adjacentNeighbours(track, track.clips[1])).map(([key, value]) => [key, value?.id ?? null]),
      [['previous', 'clip-a'], ['next', 'clip-c']],
    );
    track.clips[2].timeline_start = 9;
    assert.equal(adjacentNeighbours(track, track.clips[1]).next, null);
  });

  it('keeps a floor under the visible duration so an empty project still draws', () => {
    assert.equal(timelineDuration({ tracks: [] }), 10);
    assert.equal(timelineDuration(null), 10);
    assert.equal(timelineDuration(fixture()), 12);
  });
});
