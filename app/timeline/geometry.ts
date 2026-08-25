// Pure time and lane geometry helpers. No React, no DOM, no network.

import type { ClipLocation, Timeline, TimelineClip, TimelineTrack } from './types';

/** Matches TIMELINE_EPSILON in local_studio/desktop_domain.py. */
export const TIMELINE_EPSILON = 0.000001;

/** The smallest edit the UI emits, so float drift never reaches the contract. */
export const TIME_PRECISION = 3;

/** Keyboard nudge steps, in seconds. */
export const NUDGE_STEP = 0.1;
export const NUDGE_STEP_LARGE = 1;

export function roundTime(value: number) {
  const factor = 10 ** TIME_PRECISION;
  return Math.round(value * factor) / factor;
}

export function clampTime(value: number, minimum = 0, maximum = Number.POSITIVE_INFINITY) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function clipEnd(clip: TimelineClip) {
  return clip.timeline_start + clip.duration;
}

export function touches(left: TimelineClip, right: TimelineClip) {
  return Math.abs(clipEnd(left) - right.timeline_start) <= TIMELINE_EPSILON;
}

/** Track clips in play order; the stored array is not guaranteed to be sorted. */
export function orderedClips(track: TimelineTrack) {
  return [...track.clips].sort((first, second) => first.timeline_start - second.timeline_start);
}

export function orderedTracks(timeline: Timeline) {
  return [...timeline.tracks].sort((first, second) => first.order - second.order);
}

/** The neighbours that share an exact edit point with `clip` on its own track. */
export function adjacentNeighbours(track: TimelineTrack, clip: TimelineClip) {
  const others = track.clips.filter((item) => item.id !== clip.id);
  return {
    previous: others.find((item) => touches(item, clip)) ?? null,
    next: others.find((item) => touches(clip, item)) ?? null,
  };
}

export function findClip(timeline: Timeline, clipId: string): ClipLocation | null {
  if (!clipId) return null;
  for (const track of timeline.tracks) {
    const clip = track.clips.find((item) => item.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

/** Visible timeline length, never shorter than `minimum` so empty projects still draw. */
export function timelineDuration(timeline: Timeline | null, minimum = 10) {
  const ends = timeline?.tracks.flatMap((track) => track.clips.map(clipEnd)) ?? [];
  return Math.max(minimum, ...ends);
}

export function secondsToPercent(seconds: number, duration: number) {
  return (clampTime(seconds, 0, duration) / Math.max(duration, TIMELINE_EPSILON)) * 100;
}

/** Convert a horizontal pixel delta inside a lane into seconds. */
export function pixelsToSeconds(pixels: number, laneWidth: number, duration: number) {
  return (pixels / Math.max(1, laneWidth)) * duration;
}

/** Convert a client X coordinate inside a lane rect into a timeline second. */
export function positionToSeconds(clientX: number, lane: { left: number; width: number }, duration: number) {
  return roundTime(clampTime(pixelsToSeconds(clientX - lane.left, lane.width, duration), 0, duration));
}

export function formatTimecode(value: number) {
  const safe = Math.max(0, value);
  const minutes = Math.floor(safe / 60);
  const seconds = safe - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(1).padStart(4, '0')}`;
}

/** Clip label shown in the lane: caption text, then asset name, then the raw id. */
export function clipLabel(timeline: Timeline, clip: TimelineClip) {
  const asset = timeline.assets.find((item) => item.id === clip.asset_id);
  return clip.text?.trim() || asset?.name || clip.id;
}

export function assetDuration(timeline: Timeline, clip: TimelineClip) {
  const asset = timeline.assets.find((item) => item.id === clip.asset_id);
  return typeof asset?.duration === 'number' ? asset.duration : null;
}

/** Tracks a clip may be dropped on. Moving across kinds would change how it renders. */
export function canDropOnTrack(source: TimelineTrack, target: TimelineTrack) {
  return source.type === target.type && !target.locked;
}
