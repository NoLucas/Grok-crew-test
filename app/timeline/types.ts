// Timeline v2 shapes shared by the desktop workspace and the direct editing UI.
// These mirror `local_studio/schemas/timeline-v2.schema.json`; they are read-only
// projections of the frozen contract and must not add renderer-only fields.

export type TrackType = 'video' | 'audio' | 'caption' | 'overlay' | 'adjustment';
export type KeyframeProperty =
  | 'x' | 'y' | 'scale' | 'rotation'
  | 'crop_left' | 'crop_right' | 'crop_top' | 'crop_bottom'
  | 'opacity' | 'volume' | 'speed';
export type TimelineKeyframe = {
  id: string;
  at: number;
  value: number;
  interpolation: 'linear' | 'hold';
};
export type TimelineTransition = {
  type: 'fade' | 'crossfade' | 'dip_black';
  duration: number;
};

export type TimelineClip = {
  id: string;
  asset_id?: string | null;
  timeline_start: number;
  duration: number;
  source_in?: number;
  source_out?: number;
  locked: boolean;
  group_id?: string | null;
  transition_in?: TimelineTransition;
  transition_out?: TimelineTransition;
  text?: string;
  transform?: Record<string, number>;
  audio?: Record<string, number | boolean>;
  keyframes?: Partial<Record<KeyframeProperty, TimelineKeyframe[]>>;
};

export type TimelineTrack = {
  id: string;
  type: TrackType;
  name: string;
  order: number;
  locked: boolean;
  muted: boolean;
  solo?: boolean;
  clips: TimelineClip[];
};

export type TimelineAsset = { id: string; kind: string; name: string; path?: string; duration?: number };

export type TimelineMarker = { id: string; at: number; label?: string };

export type Timeline = {
  schema: string;
  revision: number;
  settings: Record<string, string | number | boolean>;
  assets: TimelineAsset[];
  tracks: TimelineTrack[];
  markers: TimelineMarker[];
};

export type TimelineVersion = {
  id: string;
  revision: number;
  origin: string;
  created_by: string;
  created_at: string;
};

/** A localized string in the four languages the workspace ships with. */
export type LocalizedText = { ko: string; en: string; zh: string; ja: string };

/** Where a clip sits, resolved once so callers do not re-scan every track. */
export type ClipLocation = { track: TimelineTrack; clip: TimelineClip };
