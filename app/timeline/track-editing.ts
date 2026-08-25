// Pure P1-02 helpers: multi-selection, grouping, track state, snapping, markers,
// and horizontal movement of a selected set. The sidecar remains authoritative.

import { clipEnd, findClip, orderedClips, roundTime } from './geometry';
import { buildMoveOperation, isEditable } from './operations';
import type { BuildResult, TimelineOperation } from './operations';
import type { Timeline, TimelineClip, TimelineTrack } from './types';

export type SelectionMode = 'replace' | 'toggle' | 'range';
export type SnapResult = { value: number; snapped: boolean; target: number | null };

function unique(values: string[]) {
  return [...new Set(values)];
}

function safeId(value: string) {
  return value.replace(/[^A-Za-z0-9\-_.]/g, '-').slice(0, 72) || 'selection';
}

export function groupedClipIds(timeline: Timeline, groupId: string) {
  return timeline.tracks.flatMap((track) =>
    track.clips.filter((clip) => clip.group_id === groupId).map((clip) => clip.id),
  );
}

/** Selection semantics shared by pointer and keyboard interaction. */
export function selectionForClip(
  timeline: Timeline,
  current: string[],
  clipId: string,
  mode: SelectionMode,
) {
  const target = findClip(timeline, clipId);
  if (!target) return current;

  if (mode === 'toggle') {
    return current.includes(clipId)
      ? current.filter((id) => id !== clipId)
      : [...current, clipId];
  }

  if (mode === 'range') {
    const anchor = findClip(timeline, current[current.length - 1] ?? '');
    if (!anchor || anchor.track.id !== target.track.id) return unique([...current, clipId]);
    const clips = orderedClips(target.track);
    const start = clips.findIndex((clip) => clip.id === anchor.clip.id);
    const end = clips.findIndex((clip) => clip.id === clipId);
    if (start < 0 || end < 0) return unique([...current, clipId]);
    const [low, high] = start <= end ? [start, end] : [end, start];
    return clips.slice(low, high + 1).map((clip) => clip.id);
  }

  return target.clip.group_id
    ? groupedClipIds(timeline, target.clip.group_id)
    : [clipId];
}

function mutableSelection(timeline: Timeline, clipIds: string[]) {
  for (const clipId of clipIds) {
    const location = findClip(timeline, clipId);
    if (!location) {
      return { code: 'timeline_item_not_found', details: { clip_id: clipId } };
    }
    if (!isEditable(location.track, location.clip)) {
      return {
        code: 'timeline_item_locked',
        details: { track_id: location.track.id, clip_id: location.clip.id },
      };
    }
  }
  return null;
}

export function buildGroupOperations(
  timeline: Timeline,
  clipIds: string[],
): BuildResult<TimelineOperation[]> {
  const ids = unique(clipIds);
  if (ids.length < 2) {
    return { ok: false, block: { code: 'selection_too_small', details: { minimum: 2 } } };
  }
  const lock = mutableSelection(timeline, ids);
  if (lock) return { ok: false, block: lock };
  const groupId = `group-r${timeline.revision + 1}-${safeId(ids[0])}`;
  return {
    ok: true,
    value: ids.map((clipId) => ({
      op: 'update_clip',
      clip_id: clipId,
      changes: { group_id: groupId },
    })),
  };
}

export function buildUngroupOperations(
  timeline: Timeline,
  clipIds: string[],
): BuildResult<TimelineOperation[]> {
  const groupIds = new Set(
    clipIds
      .map((clipId) => findClip(timeline, clipId)?.clip.group_id)
      .filter((groupId): groupId is string => Boolean(groupId)),
  );
  const ids = unique([
    ...clipIds,
    ...[...groupIds].flatMap((groupId) => groupedClipIds(timeline, groupId)),
  ]).filter((clipId) => Boolean(findClip(timeline, clipId)?.clip.group_id));
  if (!ids.length) {
    return { ok: false, block: { code: 'selection_has_no_group', details: {} } };
  }
  const lock = mutableSelection(timeline, ids);
  if (lock) return { ok: false, block: lock };
  return {
    ok: true,
    value: ids.map((clipId) => ({
      op: 'update_clip',
      clip_id: clipId,
      changes: { group_id: null },
    })),
  };
}

export function buildTrackStateOperation(
  track: TimelineTrack,
  field: 'locked' | 'muted' | 'solo',
): TimelineOperation {
  return { op: 'update_track', track_id: track.id, changes: { [field]: !Boolean(track[field]) } };
}

export function buildSnappingOperation(enabled: boolean): TimelineOperation {
  return { op: 'set_settings', changes: { snapping_enabled: enabled } };
}

export function buildAddMarkerOperation(
  timeline: Timeline,
  at: number,
  label = '',
): TimelineOperation {
  const base = `marker-r${timeline.revision + 1}`;
  const taken = new Set(timeline.markers.map((marker) => marker.id));
  let id = base;
  for (let attempt = 2; taken.has(id); attempt += 1) id = `${base}-${attempt}`;
  return {
    op: 'add_marker',
    marker: { id, at: roundTime(Math.max(0, at)), label: label.trim().slice(0, 120) },
  };
}

export function buildRemoveMarkerOperation(markerId: string): TimelineOperation {
  return { op: 'remove_marker', marker_id: markerId };
}

export function snappingEnabled(timeline: Timeline) {
  return timeline.settings.snapping_enabled !== false;
}

export function snapToleranceSeconds(timeline: Timeline) {
  const fps = typeof timeline.settings.fps === 'number' && timeline.settings.fps > 0
    ? timeline.settings.fps
    : 30;
  const frames = typeof timeline.settings.snap_tolerance_frames === 'number'
    ? Math.min(60, Math.max(1, timeline.settings.snap_tolerance_frames))
    : 6;
  return frames / fps;
}

export function snapCandidates(
  timeline: Timeline,
  playhead: number,
  excludedClipIds: string[] = [],
) {
  const excluded = new Set(excludedClipIds);
  return [...new Set([
    0,
    roundTime(playhead),
    ...timeline.markers.map((marker) => roundTime(marker.at)),
    ...timeline.tracks.flatMap((track) =>
      track.clips
        .filter((clip) => !excluded.has(clip.id))
        .flatMap((clip) => [roundTime(clip.timeline_start), roundTime(clipEnd(clip))]),
    ),
  ])].sort((first, second) => first - second);
}

export function snapPoint(
  timeline: Timeline,
  raw: number,
  playhead: number,
  excludedClipIds: string[] = [],
): SnapResult {
  const value = roundTime(raw);
  if (!snappingEnabled(timeline)) return { value, snapped: false, target: null };
  const nearest = snapCandidates(timeline, playhead, excludedClipIds)
    .map((target) => ({ target, distance: Math.abs(target - value) }))
    .sort((first, second) => first.distance - second.distance)[0];
  if (!nearest || nearest.distance > snapToleranceSeconds(timeline)) {
    return { value, snapped: false, target: null };
  }
  return { value: nearest.target, snapped: true, target: nearest.target };
}

/** Snap either edge of a moving clip and return its resulting start time. */
export function snapMoveStart(
  timeline: Timeline,
  clip: TimelineClip,
  rawStart: number,
  playhead: number,
  excludedClipIds: string[] = [clip.id],
): SnapResult {
  const start = roundTime(rawStart);
  if (!snappingEnabled(timeline)) return { value: start, snapped: false, target: null };
  const duration = clip.duration;
  const tolerance = snapToleranceSeconds(timeline);
  const choices = snapCandidates(timeline, playhead, excludedClipIds).flatMap((target) => [
    { value: target, target, distance: Math.abs(target - start) },
    { value: target - duration, target, distance: Math.abs(target - (start + duration)) },
  ]).sort((first, second) => first.distance - second.distance);
  const nearest = choices[0];
  if (!nearest || nearest.distance > tolerance || nearest.value < 0) {
    return { value: start, snapped: false, target: null };
  }
  return { value: roundTime(nearest.value), snapped: true, target: nearest.target };
}

export function buildMultiMoveOperations(
  timeline: Timeline,
  clipIds: string[],
  anchorClipId: string,
  anchorStart: number,
): BuildResult<TimelineOperation[]> {
  const ids = unique(clipIds);
  const anchor = findClip(timeline, anchorClipId);
  if (!anchor) {
    return { ok: false, block: { code: 'timeline_item_not_found', details: { clip_id: anchorClipId } } };
  }
  const delta = roundTime(anchorStart - anchor.clip.timeline_start);
  const operations: TimelineOperation[] = [];
  for (const clipId of ids) {
    const location = findClip(timeline, clipId);
    if (!location) {
      return { ok: false, block: { code: 'timeline_item_not_found', details: { clip_id: clipId } } };
    }
    const nextStart = roundTime(location.clip.timeline_start + delta);
    const result = buildMoveOperation(location.track, location.clip, nextStart);
    if (!result.ok) return { ok: false, block: result.block };
    operations.push(result.value);
  }
  return { ok: true, value: operations };
}
