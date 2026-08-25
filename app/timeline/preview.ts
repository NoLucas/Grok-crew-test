// Drag previews. Pure geometry only: a preview never touches the stored
// timeline, so releasing the pointer outside a valid target simply leaves the
// committed revision on screen.

import { TIMELINE_EPSILON, clipEnd } from './geometry';
import type { TimelineClip, TimelineTrack } from './types';

export type DragPreview =
  | { kind: 'move'; clipId: string; fromTrackId: string; toTrackId: string; timelineStart: number }
  | { kind: 'trim'; clipId: string; edge: 'start' | 'end'; at: number }
  | { kind: 'ripple'; clipId: string; at: number }
  | { kind: 'roll'; leftClipId: string; rightClipId: string; at: number }
  | { kind: 'slide'; clipId: string; previousClipId: string; nextClipId: string; timelineStart: number }
  | { kind: 'slip'; clipId: string; sourceIn: number; delta: number };

export type ClipRect = { timeline_start: number; duration: number };

/** The rectangle a clip should draw while a drag is in progress. */
export function previewRect(
  preview: DragPreview | null,
  track: TimelineTrack,
  clip: TimelineClip,
): ClipRect {
  const base: ClipRect = { timeline_start: clip.timeline_start, duration: clip.duration };
  if (!preview) return base;

  switch (preview.kind) {
    case 'move':
      return preview.clipId === clip.id ? { ...base, timeline_start: preview.timelineStart } : base;
    case 'trim': {
      if (preview.clipId !== clip.id) return base;
      return preview.edge === 'start'
        ? { timeline_start: preview.at, duration: clipEnd(clip) - preview.at }
        : { timeline_start: clip.timeline_start, duration: preview.at - clip.timeline_start };
    }
    case 'ripple': {
      const target = track.clips.find((item) => item.id === preview.clipId);
      if (!target) return base;
      if (clip.id === preview.clipId) {
        return { timeline_start: clip.timeline_start, duration: preview.at - clip.timeline_start };
      }
      const oldEnd = clipEnd(target);
      if (clip.timeline_start >= oldEnd - TIMELINE_EPSILON) {
        return { ...base, timeline_start: clip.timeline_start + (preview.at - oldEnd) };
      }
      return base;
    }
    case 'roll': {
      const left = track.clips.find((item) => item.id === preview.leftClipId);
      const right = track.clips.find((item) => item.id === preview.rightClipId);
      if (!left || !right) return base;
      if (clip.id === left.id) {
        return { timeline_start: left.timeline_start, duration: preview.at - left.timeline_start };
      }
      if (clip.id === right.id) {
        return { timeline_start: preview.at, duration: clipEnd(right) - preview.at };
      }
      return base;
    }
    case 'slide': {
      const selected = track.clips.find((item) => item.id === preview.clipId);
      if (!selected) return base;
      const delta = preview.timelineStart - selected.timeline_start;
      if (clip.id === preview.clipId) return { ...base, timeline_start: preview.timelineStart };
      if (clip.id === preview.previousClipId) return { ...base, duration: clip.duration + delta };
      if (clip.id === preview.nextClipId) {
        return { timeline_start: clip.timeline_start + delta, duration: clip.duration - delta };
      }
      return base;
    }
    case 'slip':
      // Slip changes which frames play, never where the clip sits.
      return base;
  }
}

/** True when this clip is one of the clips the current drag is reshaping. */
export function isPreviewTarget(preview: DragPreview | null, clipId: string) {
  if (!preview) return false;
  switch (preview.kind) {
    case 'move':
    case 'trim':
    case 'ripple':
    case 'slip':
      return preview.clipId === clipId;
    case 'roll':
      return preview.leftClipId === clipId || preview.rightClipId === clipId;
    case 'slide':
      return (
        preview.clipId === clipId || preview.previousClipId === clipId || preview.nextClipId === clipId
      );
  }
}

/** The lane a cross-track move would drop into, or null while staying put. */
export function moveTargetTrackId(preview: DragPreview | null) {
  return preview?.kind === 'move' && preview.toTrackId !== preview.fromTrackId ? preview.toTrackId : null;
}
