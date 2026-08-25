// Focused P1-02 tests for selection, grouping, track controls, snapping, markers,
// and selected-set movement.

import assert from 'node:assert/strict';
import { register } from 'node:module';
import { describe, it } from 'node:test';

register('./ts-resolver.helper.mjs', import.meta.url);

const {
  buildAddMarkerOperation,
  buildGroupOperations,
  buildMultiMoveOperations,
  buildRemoveMarkerOperation,
  buildSnappingOperation,
  buildTrackStateOperation,
  buildUngroupOperations,
  selectionForClip,
  snapMoveStart,
  snapPoint,
  snapToleranceSeconds,
} = await import('./track-editing.ts');
const { previewRect } = await import('./preview.ts');

function fixture() {
  return {
    schema: 'grok-crew.timeline/v2',
    revision: 7,
    settings: {
      width: 1080,
      height: 1920,
      fps: 30,
      quality: 'balanced',
      snapping_enabled: true,
      snap_tolerance_frames: 6,
    },
    assets: [{ id: 'source', kind: 'video', name: 'Interview', duration: 40 }],
    tracks: [
      {
        id: 'v1',
        type: 'video',
        name: 'Main',
        order: 0,
        locked: false,
        muted: false,
        solo: false,
        clips: [
          { id: 'a', asset_id: 'source', timeline_start: 0, duration: 3, locked: false },
          { id: 'b', asset_id: 'source', timeline_start: 4, duration: 3, locked: false },
          { id: 'c', asset_id: 'source', timeline_start: 8, duration: 3, locked: false },
        ],
      },
      {
        id: 'a1',
        type: 'audio',
        name: 'Voice',
        order: 10,
        locked: false,
        muted: false,
        solo: false,
        clips: [{ id: 'voice', timeline_start: 0, duration: 11, locked: false }],
      },
    ],
    markers: [{ id: 'hook', at: 5, label: 'Hook' }],
  };
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe('multi-selection', () => {
  it('toggles individual clips and selects a same-track range', () => {
    const timeline = deepFreeze(fixture());
    assert.deepEqual(selectionForClip(timeline, [], 'a', 'toggle'), ['a']);
    assert.deepEqual(selectionForClip(timeline, ['a'], 'b', 'toggle'), ['a', 'b']);
    assert.deepEqual(selectionForClip(timeline, ['a', 'b'], 'a', 'toggle'), ['b']);
    assert.deepEqual(selectionForClip(timeline, ['a'], 'c', 'range'), ['a', 'b', 'c']);
  });

  it('plain selection expands a persisted group', () => {
    const timeline = fixture();
    timeline.tracks[0].clips[0].group_id = 'dialogue';
    timeline.tracks[1].clips[0].group_id = 'dialogue';
    assert.deepEqual(selectionForClip(deepFreeze(timeline), [], 'a', 'replace'), ['a', 'voice']);
  });
});

describe('grouping and selected-set movement', () => {
  it('builds one atomic update per selected clip', () => {
    const timeline = deepFreeze(fixture());
    const result = buildGroupOperations(timeline, ['a', 'voice']);
    assert.equal(result.ok, true);
    assert.equal(result.value.length, 2);
    assert.equal(result.value[0].op, 'update_clip');
    assert.equal(result.value[0].changes.group_id, result.value[1].changes.group_id);
    assert.match(result.value[0].changes.group_id, /^group-r8-/);
  });

  it('refuses to group a locked selection', () => {
    const timeline = fixture();
    timeline.tracks[0].clips[1].locked = true;
    const result = buildGroupOperations(deepFreeze(timeline), ['a', 'b']);
    assert.equal(result.ok, false);
    assert.equal(result.block.code, 'timeline_item_locked');
    assert.equal(result.block.details.clip_id, 'b');
  });

  it('ungroups all members when any group member is selected', () => {
    const timeline = fixture();
    timeline.tracks[0].clips[0].group_id = 'pair';
    timeline.tracks[1].clips[0].group_id = 'pair';
    const result = buildUngroupOperations(deepFreeze(timeline), ['a']);
    assert.equal(result.ok, true);
    assert.deepEqual(result.value.map((operation) => operation.clip_id), ['a', 'voice']);
    assert.ok(result.value.every((operation) => operation.changes.group_id === null));
  });

  it('moves selected clips by one delta without mutating input', () => {
    const timeline = deepFreeze(fixture());
    const result = buildMultiMoveOperations(timeline, ['a', 'voice'], 'a', 2);
    assert.equal(result.ok, true);
    assert.deepEqual(result.value, [
      { op: 'move_clip', clip_id: 'a', timeline_start: 2 },
      { op: 'move_clip', clip_id: 'voice', timeline_start: 2 },
    ]);
    assert.equal(timeline.tracks[0].clips[0].timeline_start, 0);
  });

  it('previews every clip in a selected-set move', () => {
    const timeline = deepFreeze(fixture());
    const preview = { kind: 'multi-move', clipId: 'a', clipIds: ['a', 'voice'], timelineStart: 2, delta: 2 };
    assert.deepEqual(previewRect(preview, timeline.tracks[0], timeline.tracks[0].clips[0]), {
      timeline_start: 2,
      duration: 3,
    });
    assert.deepEqual(previewRect(preview, timeline.tracks[1], timeline.tracks[1].clips[0]), {
      timeline_start: 2,
      duration: 11,
    });
    assert.deepEqual(previewRect(preview, timeline.tracks[0], timeline.tracks[0].clips[1]), {
      timeline_start: 4,
      duration: 3,
    });
  });
});

describe('track state, snapping, and markers', () => {
  it('builds persisted solo, mute, lock, and snapping operations', () => {
    const track = deepFreeze(fixture().tracks[0]);
    assert.deepEqual(buildTrackStateOperation(track, 'solo'), {
      op: 'update_track',
      track_id: 'v1',
      changes: { solo: true },
    });
    assert.deepEqual(buildTrackStateOperation({ ...track, muted: true }, 'muted').changes, { muted: false });
    assert.deepEqual(buildTrackStateOperation({ ...track, locked: true }, 'locked').changes, { locked: false });
    assert.deepEqual(buildSnappingOperation(false), {
      op: 'set_settings',
      changes: { snapping_enabled: false },
    });
  });

  it('snaps a point to markers, playhead, and clip edges inside frame tolerance', () => {
    const timeline = deepFreeze(fixture());
    assert.equal(snapToleranceSeconds(timeline), 0.2);
    assert.deepEqual(snapPoint(timeline, 5.14, 9, []), {
      value: 5,
      snapped: true,
      target: 5,
    });
    assert.deepEqual(snapPoint(timeline, 9.12, 9, []), {
      value: 9,
      snapped: true,
      target: 9,
    });
    assert.equal(snapPoint(timeline, 6.5, 9, []).snapped, false);
  });

  it('snaps either edge of a moving clip and respects the off switch', () => {
    const timeline = deepFreeze(fixture());
    const clip = timeline.tracks[0].clips[0];
    // Moving a 3s clip to 1.1 puts its end at 4.1, close enough to b's 4s start.
    assert.deepEqual(snapMoveStart(timeline, clip, 1.1, 9, ['a']), {
      value: 1,
      snapped: true,
      target: 4,
    });
    const snappingOff = fixture();
    snappingOff.settings.snapping_enabled = false;
    assert.deepEqual(snapMoveStart(deepFreeze(snappingOff), snappingOff.tracks[0].clips[0], 1.1, 9, ['a']), {
      value: 1.1,
      snapped: false,
      target: null,
    });
  });

  it('creates deterministic unique marker operations', () => {
    const timeline = deepFreeze(fixture());
    assert.deepEqual(buildAddMarkerOperation(timeline, 7.25, ' Review '), {
      op: 'add_marker',
      marker: { id: 'marker-r8', at: 7.25, label: 'Review' },
    });
    assert.deepEqual(buildRemoveMarkerOperation('hook'), {
      op: 'remove_marker',
      marker_id: 'hook',
    });
  });
});
