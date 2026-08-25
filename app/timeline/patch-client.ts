// Adapter over the frozen preload bridge `window.grokCrew.applyTimelinePatch`.
//
// The bridge is injected instead of read from `window`, so the normalisation
// rules below stay pure and directly testable. This module never invents a
// transport of its own: when the bridge is missing the caller gets the
// contract's own `timeline_patch_transport_error`.

import type { TimelinePatch } from './operations';
import type { TimelinePatchFailure } from './errors';
import type { Timeline, TimelineVersion } from './types';

export type TimelinePatchSuccess = { version: TimelineVersion; timeline: Timeline };

export type TimelinePatchOutcome =
  | { ok: true; status: number; value: TimelinePatchSuccess }
  | { ok: false; status: number; error: TimelinePatchFailure };

/** Exactly the preload signature; the renderer must not widen it. */
export type ApplyTimelinePatchBridge = (projectId: string, patch: TimelinePatch) => Promise<unknown>;

function transportFailure(status = 0): { ok: false; status: number; error: TimelinePatchFailure } {
  return {
    ok: false,
    status,
    error: {
      code: 'timeline_patch_transport_error',
      message: 'The local editing service is unavailable.',
      details: {},
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readTimeline(value: unknown): Timeline | null {
  if (!isRecord(value)) return null;
  const timeline = value.timeline;
  if (!isRecord(timeline) || !Array.isArray(timeline.tracks) || typeof timeline.revision !== 'number') return null;
  return timeline as unknown as Timeline;
}

/** Normalise anything the bridge returns into one outcome the UI can trust. */
export function normalizeTimelinePatchResult(raw: unknown, fallbackStatus = 0): TimelinePatchOutcome {
  if (!isRecord(raw) || typeof raw.ok !== 'boolean') return transportFailure(fallbackStatus);
  const status = typeof raw.status === 'number' ? raw.status : fallbackStatus;

  if (raw.ok) {
    const timeline = readTimeline(raw.value);
    // A success without a usable timeline cannot be rendered; treat it as a
    // transport problem so the caller keeps the revision already on screen.
    if (!timeline) return transportFailure(status);
    const value = raw.value as Record<string, unknown>;
    return { ok: true, status, value: { version: value.version as TimelineVersion, timeline } };
  }

  const error = isRecord(raw.error) ? raw.error : {};
  return {
    ok: false,
    status,
    error: {
      code: typeof error.code === 'string' && error.code ? error.code : 'timeline_patch_failed',
      message: typeof error.message === 'string' && error.message ? error.message : 'The edit was not applied.',
      details: isRecord(error.details) ? error.details : {},
    },
  };
}

export async function sendTimelinePatch(
  bridge: ApplyTimelinePatchBridge | undefined,
  projectId: string,
  patch: TimelinePatch,
): Promise<TimelinePatchOutcome> {
  if (!bridge) return transportFailure();
  try {
    return normalizeTimelinePatchResult(await bridge(projectId, patch));
  } catch {
    return transportFailure();
  }
}
