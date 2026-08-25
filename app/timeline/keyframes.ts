import { roundTime } from './geometry';
import type { BuildResult, TimelineOperation } from './operations';
import type {
  KeyframeProperty,
  Timeline,
  TimelineClip,
  TimelineKeyframe,
  TimelineTrack,
} from './types';

export const KEYFRAME_LIMITS: Record<KeyframeProperty, { min: number; max: number; step: number }> = {
  x: { min: -10000, max: 10000, step: 1 },
  y: { min: -10000, max: 10000, step: 1 },
  scale: { min: 0.05, max: 8, step: 0.05 },
  rotation: { min: -3600, max: 3600, step: 1 },
  crop_left: { min: 0, max: 0.45, step: 0.01 },
  crop_right: { min: 0, max: 0.45, step: 0.01 },
  crop_top: { min: 0, max: 0.45, step: 0.01 },
  crop_bottom: { min: 0, max: 0.45, step: 0.01 },
  opacity: { min: 0, max: 1, step: 0.05 },
  volume: { min: 0, max: 4, step: 0.05 },
  speed: { min: 0.1, max: 8, step: 0.1 },
};

const VISUAL_PROPERTIES: KeyframeProperty[] = [
  'x', 'y', 'scale', 'rotation',
  'crop_left', 'crop_right', 'crop_top', 'crop_bottom', 'opacity',
];

export function keyframePropertiesForTrack(track: TimelineTrack): KeyframeProperty[] {
  const properties: KeyframeProperty[] = [];
  if (['video', 'overlay', 'image'].includes(track.type)) properties.push(...VISUAL_PROPERTIES);
  if (['video', 'audio'].includes(track.type)) properties.push('volume', 'speed');
  return properties;
}

export function defaultKeyframeValue(clip: TimelineClip, propertyName: KeyframeProperty) {
  if (propertyName === 'volume') return Number(clip.audio?.volume ?? 1);
  if (propertyName === 'speed') return 1;
  if (propertyName === 'scale') return Number(clip.transform?.scale ?? 1);
  if (propertyName === 'opacity') return Number(clip.transform?.opacity ?? 1);
  return Number(clip.transform?.[propertyName] ?? 0);
}

export function keyframeValue(
  clip: TimelineClip,
  propertyName: KeyframeProperty,
  at: number,
) {
  const points = [...(clip.keyframes?.[propertyName] ?? [])].sort((first, second) => first.at - second.at);
  const fallback = defaultKeyframeValue(clip, propertyName);
  if (!points.length) return fallback;
  if (at <= points[0].at) return points[0].value;
  if (at >= points[points.length - 1].at) return points[points.length - 1].value;
  const rightIndex = points.findIndex((point) => point.at > at);
  const left = points[rightIndex - 1];
  const right = points[rightIndex];
  if (left.interpolation === 'hold') return left.value;
  const ratio = (at - left.at) / Math.max(0.001, right.at - left.at);
  return left.value + (right.value - left.value) * ratio;
}

function cloneKeyframes(clip: TimelineClip) {
  return Object.fromEntries(
    Object.entries(clip.keyframes ?? {}).map(([propertyName, points]) => [
      propertyName,
      (points ?? []).map((point) => ({ ...point })),
    ]),
  ) as NonNullable<TimelineClip['keyframes']>;
}

export function buildSetKeyframeOperation(
  timeline: Timeline,
  track: TimelineTrack,
  clip: TimelineClip,
  propertyName: KeyframeProperty,
  at: number,
  value: number,
  interpolation: TimelineKeyframe['interpolation'] = 'linear',
): BuildResult<TimelineOperation> {
  if (track.locked || clip.locked) {
    return {
      ok: false,
      block: { code: 'timeline_item_locked', details: { track_id: track.id, clip_id: clip.id } },
    };
  }
  if (!keyframePropertiesForTrack(track).includes(propertyName)) {
    return { ok: false, block: { code: 'invalid_operation', details: { field: 'property', property: propertyName } } };
  }
  const relativeAt = roundTime(at);
  if (relativeAt < 0 || relativeAt > clip.duration) {
    return {
      ok: false,
      block: { code: 'invalid_time_range', details: { field: 'keyframe.at', received: relativeAt, duration: clip.duration } },
    };
  }
  const limits = KEYFRAME_LIMITS[propertyName];
  if (!Number.isFinite(value) || value < limits.min || value > limits.max) {
    return {
      ok: false,
      block: { code: 'invalid_operation', details: { field: 'keyframe.value', property: propertyName, received: value } },
    };
  }
  const keyframes = cloneKeyframes(clip);
  const current = keyframes[propertyName] ?? [];
  const existing = current.find((point) => Math.abs(point.at - relativeAt) < 0.0005);
  const point: TimelineKeyframe = {
    id: existing?.id ?? `${propertyName}-r${timeline.revision + 1}-${Math.round(relativeAt * 1000)}`,
    at: relativeAt,
    value,
    interpolation,
  };
  keyframes[propertyName] = [
    ...current.filter((item) => item.id !== existing?.id),
    point,
  ].sort((first, second) => first.at - second.at);
  return {
    ok: true,
    value: { op: 'update_clip', clip_id: clip.id, changes: { keyframes } },
  };
}

export function buildRemoveKeyframeOperation(
  track: TimelineTrack,
  clip: TimelineClip,
  propertyName: KeyframeProperty,
  keyframeId: string,
): BuildResult<TimelineOperation> {
  if (track.locked || clip.locked) {
    return {
      ok: false,
      block: { code: 'timeline_item_locked', details: { track_id: track.id, clip_id: clip.id } },
    };
  }
  const keyframes = cloneKeyframes(clip);
  const current = keyframes[propertyName] ?? [];
  if (!current.some((point) => point.id === keyframeId)) {
    return { ok: false, block: { code: 'timeline_item_not_found', details: { keyframe_id: keyframeId } } };
  }
  keyframes[propertyName] = current.filter((point) => point.id !== keyframeId);
  return {
    ok: true,
    value: { op: 'update_clip', clip_id: clip.id, changes: { keyframes } },
  };
}
