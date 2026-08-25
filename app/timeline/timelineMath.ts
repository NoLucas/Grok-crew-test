// Pure, framework-free helpers for the P1-01 timeline editor: time/pixel
// conversion, snapping, range clamping, and timeline-patch operation
// builders. No React or DOM here so these can run under `node --test`
// without a browser or a bundler. Range rules mirror local_studio/
// desktop_domain.py's _apply_trim / roll_edit / slide_clip validation so the
// UI rarely sends an operation the backend would reject — the backend stays
// the authority; this is UX polish only.

import type { Clip, Origin, PatchOperation, Timeline, TimelinePatchBody, Track } from './timelineTypes';

export const MIN_PX_PER_SECOND = 12;
export const MAX_PX_PER_SECOND = 400;
export const DEFAULT_PX_PER_SECOND = 60;
export const SNAP_THRESHOLD_PX = 8;
export const EPSILON = 0.001;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function clipEnd(clip: Pick<Clip, 'timeline_start' | 'duration'>): number {
  return clip.timeline_start + clip.duration;
}

export function timeToPx(time: number, pxPerSecond: number): number {
  return time * pxPerSecond;
}

export function pxToTime(px: number, pxPerSecond: number): number {
  return px / pxPerSecond;
}

export function frameSeconds(fps: number): number {
  return fps > 0 ? 1 / fps : 1 / 30;
}

export function timelineDuration(timeline: Pick<Timeline, 'tracks'>, minimum = 10): number {
  let max = minimum;
  for (const track of timeline.tracks) {
    for (const clip of track.clips) max = Math.max(max, clipEnd(clip));
  }
  return max;
}

export function isClipLocked(track: Pick<Track, 'locked'>, clip: Pick<Clip, 'locked'>): boolean {
  return Boolean(track.locked) || Boolean(clip.locked);
}

export function hasSourceWindow(clip: Clip): boolean {
  return typeof clip.source_in === 'number' && typeof clip.source_out === 'number';
}

/** Every clip start/end across all tracks, plus 0 and (optionally) the playhead. Used as drag-snap candidates. */
export function collectSnapPoints(
  timeline: Pick<Timeline, 'tracks'>,
  options: { excludeClipIds?: Set<string>; playhead?: number } = {},
): number[] {
  const points = new Set<number>([0]);
  if (typeof options.playhead === 'number') points.add(round3(options.playhead));
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (options.excludeClipIds?.has(clip.id)) continue;
      points.add(round3(clip.timeline_start));
      points.add(round3(clipEnd(clip)));
    }
  }
  return [...points].sort((a, b) => a - b);
}

export type SnapResult = { value: number; snapped: boolean; snapPoint?: number };

export function snapTime(target: number, candidates: number[], pxPerSecond: number, thresholdPx = SNAP_THRESHOLD_PX): SnapResult {
  const thresholdSeconds = thresholdPx / Math.max(1, pxPerSecond);
  let best: number | undefined;
  let bestDelta = Infinity;
  for (const candidate of candidates) {
    const delta = Math.abs(candidate - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = candidate;
    }
  }
  if (best !== undefined && bestDelta <= thresholdSeconds) return { value: best, snapped: true, snapPoint: best };
  return { value: round3(target), snapped: false };
}

/** Keeps a trim/split boundary strictly inside (clip.timeline_start, clip end), matching _apply_trim's backend rule for both edges. */
export function clampInsideClip(clip: Pick<Clip, 'timeline_start' | 'duration'>, at: number): number {
  const min = clip.timeline_start + EPSILON;
  const max = clipEnd(clip) - EPSILON;
  if (min >= max) return clip.timeline_start + clip.duration / 2;
  return clamp(at, min, max);
}

/** Keeps a roll boundary strictly inside the combined (left.start, right.end) span. */
export function clampRollBoundary(left: Pick<Clip, 'timeline_start' | 'duration'>, right: Pick<Clip, 'timeline_start' | 'duration'>, at: number): number {
  const min = left.timeline_start + EPSILON;
  const max = clipEnd(right) - EPSILON;
  if (min >= max) return left.timeline_start + (clipEnd(right) - left.timeline_start) / 2;
  return clamp(at, min, max);
}

/**
 * Keeps both slide neighbors longer than zero, matching slide_clip's backend rule
 * (previous.duration + delta > 0 and following.duration - delta > 0, where
 * delta = timelineStart - selected.timeline_start). previous/selected/following
 * must already be touching, as the backend requires via _assert_touching.
 */
export function clampSlideStart(
  previous: Pick<Clip, 'timeline_start' | 'duration'>,
  selected: Pick<Clip, 'timeline_start' | 'duration'>,
  following: Pick<Clip, 'timeline_start' | 'duration'>,
  timelineStart: number,
): number {
  const min = previous.timeline_start + EPSILON;
  const max = clipEnd(following) - selected.duration - EPSILON;
  if (min >= max) return selected.timeline_start;
  return clamp(timelineStart, min, max);
}

export function buildPatchBody(baseRevision: number, operations: PatchOperation[], createdBy = 'operator', origin: Origin = 'human'): TimelinePatchBody {
  return { schema: 'grok-crew.timeline-patch/v1', base_revision: baseRevision, origin, created_by: createdBy, operations };
}

export function moveClipOp(clipId: string, timelineStart: number, trackId?: string): PatchOperation {
  const op: PatchOperation = { op: 'move_clip', clip_id: clipId, timeline_start: round3(timelineStart) };
  if (trackId) op.track_id = trackId;
  return op;
}

export function trimClipOp(clipId: string, edge: 'start' | 'end', at: number): PatchOperation {
  return { op: 'trim_clip', clip_id: clipId, edge, at: round3(at) };
}

export function splitClipOp(clipId: string, at: number, leftId?: string, rightId?: string): PatchOperation {
  const op: PatchOperation = { op: 'split_clip', clip_id: clipId, at: round3(at) };
  if (leftId) op.left_id = leftId;
  if (rightId) op.right_id = rightId;
  return op;
}

export function rippleTrimOp(clipId: string, at: number): PatchOperation {
  return { op: 'ripple_trim', clip_id: clipId, edge: 'end', at: round3(at) };
}

export function rollEditOp(leftClipId: string, rightClipId: string, at: number): PatchOperation {
  return { op: 'roll_edit', left_clip_id: leftClipId, right_clip_id: rightClipId, at: round3(at) };
}

export function slipClipOp(clipId: string, sourceIn: number): PatchOperation {
  return { op: 'slip_clip', clip_id: clipId, source_in: round3(sourceIn) };
}

export function slideClipOp(previousClipId: string, clipId: string, nextClipId: string, timelineStart: number): PatchOperation {
  return { op: 'slide_clip', previous_clip_id: previousClipId, clip_id: clipId, next_clip_id: nextClipId, timeline_start: round3(timelineStart) };
}

export function removeClipOp(clipId: string): PatchOperation {
  return { op: 'remove_clip', clip_id: clipId };
}

export function updateClipOp(clipId: string, changes: Record<string, unknown>): PatchOperation {
  return { op: 'update_clip', clip_id: clipId, changes };
}
