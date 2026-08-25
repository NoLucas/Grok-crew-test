// Pure builders for the seven P1-01 timeline edit operations.
//
// Every builder either returns a contract-shaped operation or an `EditBlock`
// carrying the same error code the sidecar would return. The sidecar stays the
// authority: these guards exist so the UI can clamp a drag, disable a control,
// and explain the limit before a request is spent — never to replace validation.
// Rules mirror `apply_timeline_patch` in local_studio/desktop_domain.py.

import {
  TIMELINE_EPSILON,
  adjacentNeighbours,
  assetDuration,
  clipEnd,
  roundTime,
  touches,
} from './geometry';
import type { Timeline, TimelineClip, TimelineTrack } from './types';

export const TIMELINE_PATCH_SCHEMA = 'grok-crew.timeline-patch/v1';

export type TimelineOperation =
  | { op: 'move_clip'; clip_id: string; timeline_start: number; track_id?: string }
  | { op: 'trim_clip'; clip_id: string; edge: 'start' | 'end'; at: number }
  | { op: 'split_clip'; clip_id: string; at: number; left_id?: string; right_id?: string }
  | { op: 'ripple_trim'; clip_id: string; edge: 'end'; at: number }
  | { op: 'roll_edit'; left_clip_id: string; right_clip_id: string; at: number }
  | { op: 'slip_clip'; clip_id: string; source_in: number }
  | {
      op: 'slide_clip';
      previous_clip_id: string;
      clip_id: string;
      next_clip_id: string;
      timeline_start: number;
    };

export type TimelinePatch = {
  schema: typeof TIMELINE_PATCH_SCHEMA;
  base_revision: number;
  origin: 'human';
  created_by: string;
  operations: TimelineOperation[];
};

/** A locally detected reason an edit cannot be sent, using sidecar error codes. */
export type EditBlock = { code: string; details: Record<string, unknown> };

export type BuildResult<T> = { ok: true; value: T } | { ok: false; block: EditBlock };

function blocked(code: string, details: Record<string, unknown> = {}): { ok: false; block: EditBlock } {
  return { ok: false, block: { code, details } };
}

function built<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

export function buildTimelinePatch(
  baseRevision: number,
  createdBy: string,
  operations: TimelineOperation[],
): TimelinePatch {
  return {
    schema: TIMELINE_PATCH_SCHEMA,
    base_revision: baseRevision,
    origin: 'human',
    created_by: createdBy,
    operations,
  };
}

// --- shared guards -----------------------------------------------------------

/** Mirrors `_assert_mutable`: a locked track or clip rejects every edit. */
export function lockBlock(track: TimelineTrack, clip?: TimelineClip): EditBlock | null {
  if (track.locked) return { code: 'timeline_item_locked', details: { track_id: track.id, clip_id: clip?.id ?? null } };
  if (clip?.locked) return { code: 'timeline_item_locked', details: { track_id: track.id, clip_id: clip.id } };
  return null;
}

export function isEditable(track: TimelineTrack, clip?: TimelineClip) {
  return lockBlock(track, clip) === null;
}

/** Mirrors `_apply_trim`: the point has to sit strictly inside the clip. */
function insideClip(clip: TimelineClip, at: number) {
  return at - clip.timeline_start > TIMELINE_EPSILON && clipEnd(clip) - at > TIMELINE_EPSILON;
}

/** Mirrors `_validate_source_window`: slip and trim need a usable source window. */
function sourceWindowBlock(timeline: Timeline, clip: TimelineClip, sourceIn: number, sourceOut: number): EditBlock | null {
  if (sourceIn < 0) {
    return { code: 'invalid_time_range', details: { field: 'source_in', minimum: 0, received: sourceIn } };
  }
  if (sourceOut - sourceIn <= TIMELINE_EPSILON) {
    return { code: 'invalid_source_range', details: { clip_id: clip.id, source_in: sourceIn, source_out: sourceOut } };
  }
  const duration = assetDuration(timeline, clip);
  if (duration !== null && sourceOut - duration > TIMELINE_EPSILON) {
    return {
      code: 'source_range_exceeds_asset',
      details: { clip_id: clip.id, source_out: sourceOut, asset_duration: duration },
    };
  }
  return null;
}

// --- move --------------------------------------------------------------------

export function buildMoveOperation(
  sourceTrack: TimelineTrack,
  clip: TimelineClip,
  timelineStart: number,
  targetTrack?: TimelineTrack,
): BuildResult<TimelineOperation> {
  const sourceLock = lockBlock(sourceTrack, clip);
  if (sourceLock) return { ok: false, block: sourceLock };
  const destination = targetTrack ?? sourceTrack;
  if (destination.id !== sourceTrack.id) {
    if (destination.type !== sourceTrack.type) {
      return blocked('invalid_operation', { field: 'track_id', from: sourceTrack.type, to: destination.type });
    }
    const targetLock = lockBlock(destination);
    if (targetLock) return { ok: false, block: targetLock };
  }
  const start = roundTime(timelineStart);
  if (start < 0) return blocked('invalid_time_range', { field: 'timeline_start', minimum: 0, received: start });
  return built(
    destination.id === sourceTrack.id
      ? { op: 'move_clip', clip_id: clip.id, timeline_start: start }
      : { op: 'move_clip', clip_id: clip.id, timeline_start: start, track_id: destination.id },
  );
}

// --- trim --------------------------------------------------------------------

/**
 * Keep a trim drag inside the clip so the preview can never be an invalid patch.
 * `_apply_trim` requires the point to sit strictly inside, which means a trim
 * only ever shortens a clip — lengthening is a roll or a duration edit.
 */
export function clampTrimEdge(clip: TimelineClip, edge: 'start' | 'end', at: number) {
  const minimumSpan = 10 ** -3;
  return roundTime(Math.min(Math.max(at, clip.timeline_start + minimumSpan), clipEnd(clip) - minimumSpan));
}

export function buildTrimOperation(
  timeline: Timeline,
  track: TimelineTrack,
  clip: TimelineClip,
  edge: 'start' | 'end',
  at: number,
): BuildResult<TimelineOperation> {
  const lock = lockBlock(track, clip);
  if (lock) return { ok: false, block: lock };
  const boundary = roundTime(at);
  if (boundary < 0) return blocked('invalid_time_range', { field: 'at', minimum: 0, received: boundary });
  if (!insideClip(clip, boundary)) {
    return blocked('invalid_time_range', {
      clip_id: clip.id,
      start: clip.timeline_start,
      end: clipEnd(clip),
      at: boundary,
    });
  }
  if (typeof clip.source_in === 'number' && typeof clip.source_out === 'number') {
    // Source moves 1:1 with the timeline edge, exactly as `_apply_trim` does.
    const delta = edge === 'start' ? boundary - clip.timeline_start : boundary - clipEnd(clip);
    const sourceIn = edge === 'start' ? clip.source_in + delta : clip.source_in;
    const sourceOut = edge === 'end' ? clip.source_out + delta : clip.source_out;
    const sourceBlock = sourceWindowBlock(timeline, clip, sourceIn, sourceOut);
    if (sourceBlock) return { ok: false, block: sourceBlock };
  }
  return built({ op: 'trim_clip', clip_id: clip.id, edge, at: boundary });
}

// --- split -------------------------------------------------------------------

function sanitizeIdentifier(value: string) {
  return value.replace(/[^A-Za-z0-9\-_.]/g, '-').slice(0, 100) || 'clip';
}

/** Deterministic, contract-safe ids for the two halves that stay unique. */
export function splitIdentifiers(timeline: Timeline, clip: TimelineClip) {
  const taken = new Set(timeline.tracks.flatMap((track) => track.clips.map((item) => item.id)));
  const base = sanitizeIdentifier(clip.id);
  const suffix = `r${timeline.revision + 1}`;
  let attempt = 0;
  for (;;) {
    const tag = attempt === 0 ? suffix : `${suffix}-${attempt}`;
    const left = `${base}-${tag}a`;
    const right = `${base}-${tag}b`;
    if (!taken.has(left) && !taken.has(right)) return { left_id: left, right_id: right };
    attempt += 1;
    if (attempt > 50) return { left_id: `${base}-a`, right_id: `${base}-b` };
  }
}

export function buildSplitOperation(
  timeline: Timeline,
  track: TimelineTrack,
  clip: TimelineClip,
  at: number,
): BuildResult<TimelineOperation> {
  const lock = lockBlock(track, clip);
  if (lock) return { ok: false, block: lock };
  const boundary = roundTime(at);
  if (!insideClip(clip, boundary)) {
    return blocked('invalid_time_range', {
      clip_id: clip.id,
      start: clip.timeline_start,
      end: clipEnd(clip),
      at: boundary,
    });
  }
  return built({ op: 'split_clip', clip_id: clip.id, at: boundary, ...splitIdentifiers(timeline, clip) });
}

// --- ripple trim -------------------------------------------------------------

/** Clips that ripple_trim will shift; all of them must be unlocked. */
export function rippleFollowers(track: TimelineTrack, clip: TimelineClip) {
  const end = clipEnd(clip);
  return track.clips.filter((item) => item.id !== clip.id && item.timeline_start >= end - TIMELINE_EPSILON);
}

export function buildRippleOperation(
  timeline: Timeline,
  track: TimelineTrack,
  clip: TimelineClip,
  at: number,
): BuildResult<TimelineOperation> {
  const lock = lockBlock(track, clip);
  if (lock) return { ok: false, block: lock };
  const followers = rippleFollowers(track, clip);
  const lockedFollower = followers.find((item) => item.locked);
  if (lockedFollower) {
    return blocked('timeline_item_locked', { track_id: track.id, clip_id: lockedFollower.id });
  }
  const boundary = roundTime(at);
  if (!insideClip(clip, boundary)) {
    return blocked('invalid_time_range', {
      clip_id: clip.id,
      start: clip.timeline_start,
      end: clipEnd(clip),
      at: boundary,
    });
  }
  if (typeof clip.source_in === 'number' && typeof clip.source_out === 'number') {
    const sourceOut = clip.source_out + (boundary - clipEnd(clip));
    const sourceBlock = sourceWindowBlock(timeline, clip, clip.source_in, sourceOut);
    if (sourceBlock) return { ok: false, block: sourceBlock };
  }
  return built({ op: 'ripple_trim', clip_id: clip.id, edge: 'end', at: boundary });
}

// --- roll --------------------------------------------------------------------

export function clampRollBoundary(left: TimelineClip, right: TimelineClip, at: number) {
  const minimumSpan = 10 ** -3;
  return roundTime(Math.min(Math.max(at, left.timeline_start + minimumSpan), clipEnd(right) - minimumSpan));
}

export function buildRollOperation(
  timeline: Timeline,
  track: TimelineTrack,
  left: TimelineClip,
  right: TimelineClip,
  at: number,
): BuildResult<TimelineOperation> {
  const leftLock = lockBlock(track, left);
  if (leftLock) return { ok: false, block: leftLock };
  const rightLock = lockBlock(track, right);
  if (rightLock) return { ok: false, block: rightLock };
  if (!touches(left, right)) {
    return blocked('clips_not_adjacent', { left_clip_id: left.id, right_clip_id: right.id });
  }
  const boundary = roundTime(at);
  const outerStart = left.timeline_start;
  const outerEnd = clipEnd(right);
  if (boundary - outerStart <= TIMELINE_EPSILON || outerEnd - boundary <= TIMELINE_EPSILON) {
    return blocked('invalid_time_range', { at: boundary, outer_start: outerStart, outer_end: outerEnd });
  }
  const delta = boundary - clipEnd(left);
  if (typeof left.source_out === 'number' && typeof left.source_in === 'number') {
    const sourceBlock = sourceWindowBlock(timeline, left, left.source_in, left.source_out + delta);
    if (sourceBlock) return { ok: false, block: sourceBlock };
  }
  if (typeof right.source_in === 'number' && typeof right.source_out === 'number') {
    const sourceBlock = sourceWindowBlock(timeline, right, right.source_in + delta, right.source_out);
    if (sourceBlock) return { ok: false, block: sourceBlock };
  }
  return built({ op: 'roll_edit', left_clip_id: left.id, right_clip_id: right.id, at: boundary });
}

// --- slip --------------------------------------------------------------------

/** Slip keeps the clip where it is and slides the source window inside the asset. */
export function clampSlipSourceIn(timeline: Timeline, clip: TimelineClip, sourceIn: number) {
  if (typeof clip.source_in !== 'number' || typeof clip.source_out !== 'number') return roundTime(Math.max(0, sourceIn));
  const span = clip.source_out - clip.source_in;
  const duration = assetDuration(timeline, clip);
  const maximum = duration === null ? Number.POSITIVE_INFINITY : Math.max(0, duration - span);
  return roundTime(Math.min(Math.max(sourceIn, 0), maximum));
}

export function buildSlipOperation(
  timeline: Timeline,
  track: TimelineTrack,
  clip: TimelineClip,
  sourceIn: number,
): BuildResult<TimelineOperation> {
  const lock = lockBlock(track, clip);
  if (lock) return { ok: false, block: lock };
  if (typeof clip.source_in !== 'number' || typeof clip.source_out !== 'number') {
    return blocked('invalid_source_range', { clip_id: clip.id });
  }
  const span = clip.source_out - clip.source_in;
  const nextIn = roundTime(sourceIn);
  const sourceBlock = sourceWindowBlock(timeline, clip, nextIn, nextIn + span);
  if (sourceBlock) return { ok: false, block: sourceBlock };
  return built({ op: 'slip_clip', clip_id: clip.id, source_in: nextIn });
}

// --- slide -------------------------------------------------------------------

/** Slide keeps the clip's length and trades time between the two neighbours. */
export function clampSlideStart(
  previous: TimelineClip,
  clip: TimelineClip,
  next: TimelineClip,
  timelineStart: number,
) {
  const minimumSpan = 10 ** -3;
  const minimumStart = clip.timeline_start - (previous.duration - minimumSpan);
  const maximumStart = clip.timeline_start + (next.duration - minimumSpan);
  return roundTime(Math.min(Math.max(timelineStart, Math.max(0, minimumStart)), maximumStart));
}

export function buildSlideOperation(
  timeline: Timeline,
  track: TimelineTrack,
  clip: TimelineClip,
  timelineStart: number,
): BuildResult<TimelineOperation> {
  const { previous, next } = adjacentNeighbours(track, clip);
  if (!previous || !next) {
    return blocked('clips_not_adjacent', {
      clip_id: clip.id,
      previous_clip_id: previous?.id ?? null,
      next_clip_id: next?.id ?? null,
    });
  }
  for (const item of [previous, clip, next]) {
    const lock = lockBlock(track, item);
    if (lock) return { ok: false, block: lock };
  }
  const start = roundTime(timelineStart);
  if (start < 0) return blocked('invalid_time_range', { field: 'timeline_start', minimum: 0, received: start });
  const delta = start - clip.timeline_start;
  if (previous.duration + delta <= TIMELINE_EPSILON || next.duration - delta <= TIMELINE_EPSILON) {
    return blocked('invalid_time_range', { timeline_start: start });
  }
  if (typeof previous.source_in === 'number' && typeof previous.source_out === 'number') {
    const sourceBlock = sourceWindowBlock(timeline, previous, previous.source_in, previous.source_out + delta);
    if (sourceBlock) return { ok: false, block: sourceBlock };
  }
  if (typeof next.source_in === 'number' && typeof next.source_out === 'number') {
    const sourceBlock = sourceWindowBlock(timeline, next, next.source_in + delta, next.source_out);
    if (sourceBlock) return { ok: false, block: sourceBlock };
  }
  return built({
    op: 'slide_clip',
    previous_clip_id: previous.id,
    clip_id: clip.id,
    next_clip_id: next.id,
    timeline_start: start,
  });
}
