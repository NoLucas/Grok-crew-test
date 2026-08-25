// Types mirror local_studio/schemas/timeline-patch-v1.schema.json and
// desktop_domain.py's TIMELINE_SCHEMA (grok-crew.timeline/v2). Kept local to
// app/timeline/** so this module has no compile-time dependency on
// app/desktop-workspace.tsx; the shapes are structurally compatible.

export type Origin = 'human' | 'remote_bot' | 'local_system';
export type TrackType = 'video' | 'audio' | 'caption' | 'overlay' | 'adjustment';

export type Clip = {
  id: string;
  asset_id?: string | null;
  timeline_start: number;
  duration: number;
  source_in?: number;
  source_out?: number;
  locked: boolean;
  text?: string;
  transform?: Record<string, number>;
  audio?: Record<string, number | boolean>;
};

export type Track = {
  id: string;
  type: TrackType;
  name: string;
  order: number;
  locked: boolean;
  muted: boolean;
  clips: Clip[];
};

export type Marker = { id?: string; at?: number; label?: string };

export type Timeline = {
  schema: string;
  revision: number;
  settings: Record<string, string | number | boolean>;
  assets: Array<{ id: string; kind: string; name: string; path?: string }>;
  tracks: Track[];
  markers: Marker[];
};

export type PatchOperation = { op: string } & Record<string, unknown>;

export type TimelinePatchBody = {
  schema: 'grok-crew.timeline-patch/v1';
  base_revision: number;
  origin: Origin;
  created_by?: string;
  operations: PatchOperation[];
};

export type PatchErrorPayload = { code: string; message: string; details: Record<string, unknown> };

export type PatchErrorKind = 'locked' | 'stale' | 'not_found' | 'validation' | 'transport' | 'unknown';

export class TimelinePatchClientError extends Error {
  code: string;
  status: number;
  details: Record<string, unknown>;

  constructor(payload: PatchErrorPayload, status: number) {
    super(payload.message);
    this.name = 'TimelinePatchClientError';
    this.code = payload.code;
    this.status = status;
    this.details = payload.details ?? {};
  }
}

export function classifyPatchError(error: unknown): { kind: PatchErrorKind; error?: TimelinePatchClientError } {
  if (!(error instanceof TimelinePatchClientError)) return { kind: 'unknown' };
  if (error.code === 'timeline_item_locked') return { kind: 'locked', error };
  if (error.code === 'stale_timeline_revision') return { kind: 'stale', error };
  if (error.code === 'timeline_item_not_found') return { kind: 'not_found', error };
  if (error.code === 'timeline_patch_transport_error') return { kind: 'transport', error };
  return { kind: 'validation', error };
}
