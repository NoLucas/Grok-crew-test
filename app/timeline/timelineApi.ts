// Thin client for POST /api/v2/projects/{id}/timeline/patch. Prefers the
// dedicated `window.grokCrew.applyTimelinePatch` IPC channel (added by the
// P1-01 contract in desktop/main.mjs + desktop/preload.cjs), which already
// returns a structured {ok, status, value|error} result instead of throwing
// a flattened Error like the generic `window.grokCrew.request` passthrough
// used elsewhere in app/desktop-workspace.tsx does. Falls back to a direct
// fetch for the browser dev server (no Electron preload present).
//
// This file does not change the API/IPC contract — it only calls the
// channel Codex already added. `window.grokCrew` itself is declared once,
// ambiently, in app/desktop-workspace.tsx; re-declaring it here would
// conflict (TS2717) since every `declare global` for the same interface
// must agree exactly.

import type { Timeline, TimelinePatchBody } from './timelineTypes';
import { TimelinePatchClientError } from './timelineTypes';

function studioBase(): string {
  return typeof window !== 'undefined' && window.grokCrew?.apiBase ? window.grokCrew.apiBase : 'http://127.0.0.1:7214';
}

function authToken(): string {
  return typeof window === 'undefined' ? '' : window.localStorage.getItem('localStudioToken') ?? '';
}

export async function applyTimelinePatch(projectId: string, patch: TimelinePatchBody): Promise<Timeline> {
  if (typeof window !== 'undefined' && window.grokCrew?.applyTimelinePatch) {
    const result = await window.grokCrew.applyTimelinePatch(projectId, patch);
    if (result.ok) return result.value.timeline as Timeline;
    throw new TimelinePatchClientError(result.error, result.status);
  }

  const token = authToken();
  const response = await fetch(`${studioBase()}/api/v2/projects/${encodeURIComponent(projectId)}/timeline/patch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(patch),
  });
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new TimelinePatchClientError({ code: 'timeline_patch_transport_error', message: 'The local editing service returned an invalid response.', details: {} }, response.status);
  }
  if (!response.ok) {
    const payload = data as { error?: string; code?: string; details?: Record<string, unknown> };
    throw new TimelinePatchClientError(
      { code: String(payload.code ?? 'timeline_patch_failed'), message: String(payload.error ?? `Local Studio ${response.status}`), details: payload.details ?? {} },
      response.status,
    );
  }
  return (data as { timeline: Timeline }).timeline;
}
