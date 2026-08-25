import assert from 'node:assert/strict';
import { register } from 'node:module';
import { describe, it } from 'node:test';

register('./ts-resolver.helper.mjs', import.meta.url);

const {
  buildRemoveKeyframeOperation,
  buildSetKeyframeOperation,
  keyframePropertiesForTrack,
  keyframeValue,
} = await import('./keyframes.ts');

function fixture() {
  return {
    schema: 'grok-crew.timeline/v2',
    revision: 4,
    settings: { width: 1080, height: 1920, fps: 30, quality: 'balanced' },
    assets: [{ id: 'asset', kind: 'video', name: 'Video', duration: 20 }],
    tracks: [{
      id: 'v1',
      type: 'video',
      name: 'Main',
      order: 0,
      locked: false,
      muted: false,
      solo: false,
      clips: [{
        id: 'clip',
        asset_id: 'asset',
        timeline_start: 2,
        duration: 8,
        locked: false,
        transform: { scale: 1, opacity: 1 },
        audio: { volume: 1 },
        keyframes: {},
      }],
    }],
    markers: [],
  };
}

describe('P1-05 keyframe builders', () => {
  it('sets and replaces a point at clip-local time', () => {
    const timeline = fixture();
    const track = timeline.tracks[0];
    const clip = track.clips[0];
    const first = buildSetKeyframeOperation(timeline, track, clip, 'scale', 2, 1.5, 'linear');
    assert.equal(first.ok, true);
    assert.deepEqual(first.value.changes.keyframes.scale, [{
      id: 'scale-r5-2000',
      at: 2,
      value: 1.5,
      interpolation: 'linear',
    }]);

    clip.keyframes = first.value.changes.keyframes;
    const replacement = buildSetKeyframeOperation(timeline, track, clip, 'scale', 2, 2, 'hold');
    assert.equal(replacement.value.changes.keyframes.scale.length, 1);
    assert.deepEqual(replacement.value.changes.keyframes.scale[0], {
      id: 'scale-r5-2000',
      at: 2,
      value: 2,
      interpolation: 'hold',
    });
  });

  it('removes one point without changing another property', () => {
    const timeline = fixture();
    const track = timeline.tracks[0];
    const clip = track.clips[0];
    clip.keyframes = {
      scale: [{ id: 'scale-a', at: 1, value: 1.2, interpolation: 'linear' }],
      volume: [{ id: 'volume-a', at: 1, value: 0.8, interpolation: 'linear' }],
    };
    const result = buildRemoveKeyframeOperation(track, clip, 'scale', 'scale-a');
    assert.equal(result.ok, true);
    assert.deepEqual(result.value.changes.keyframes.scale, []);
    assert.equal(result.value.changes.keyframes.volume[0].id, 'volume-a');
  });

  it('refuses locked, out-of-range, and incompatible keyframes', () => {
    const timeline = fixture();
    const track = timeline.tracks[0];
    const clip = track.clips[0];
    assert.equal(buildSetKeyframeOperation(timeline, track, { ...clip, locked: true }, 'scale', 1, 2).block.code, 'timeline_item_locked');
    assert.equal(buildSetKeyframeOperation(timeline, track, clip, 'opacity', 9, 1).block.code, 'invalid_time_range');
    assert.equal(buildSetKeyframeOperation(timeline, track, clip, 'opacity', 1, 2).block.code, 'invalid_operation');
    const caption = { ...track, type: 'caption' };
    assert.equal(buildSetKeyframeOperation(timeline, caption, clip, 'scale', 1, 2).block.code, 'invalid_operation');
  });
});

describe('P1-05 keyframe interpolation', () => {
  it('interpolates linear values and holds stepped values', () => {
    const clip = fixture().tracks[0].clips[0];
    clip.keyframes = {
      x: [
        { id: 'a', at: 0, value: 0, interpolation: 'linear' },
        { id: 'b', at: 4, value: 100, interpolation: 'linear' },
      ],
      opacity: [
        { id: 'a', at: 0, value: 0.2, interpolation: 'hold' },
        { id: 'b', at: 4, value: 1, interpolation: 'linear' },
      ],
    };
    assert.equal(keyframeValue(clip, 'x', 2), 50);
    assert.equal(keyframeValue(clip, 'opacity', 2), 0.2);
    assert.equal(keyframeValue(clip, 'scale', 2), 1);
  });

  it('offers visual and audio properties only on compatible tracks', () => {
    const video = fixture().tracks[0];
    assert.ok(keyframePropertiesForTrack(video).includes('rotation'));
    assert.ok(keyframePropertiesForTrack(video).includes('volume'));
    assert.deepEqual(keyframePropertiesForTrack({ ...video, type: 'caption' }), []);
    assert.deepEqual(keyframePropertiesForTrack({ ...video, type: 'audio' }), ['volume', 'speed']);
  });
});
