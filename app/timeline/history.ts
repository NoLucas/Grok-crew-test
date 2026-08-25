import type { Timeline, TimelineVersion } from './types';

export const TIMELINE_HISTORY_SCHEMA = 'grok-crew.timeline-history/v1';

export type TimelineHistoryState = {
  schema: typeof TIMELINE_HISTORY_SCHEMA;
  head_revision: number;
  can_undo: boolean;
  can_redo: boolean;
  undo_count: number;
  redo_count: number;
  undo_revision: number | null;
  redo_revision: number | null;
};

export type TimelineHistoryAction = 'undo' | 'redo';

export type TimelineHistoryResult = {
  timeline: Timeline;
  version: TimelineVersion;
  history: TimelineHistoryState;
};

export function emptyTimelineHistory(headRevision = 0): TimelineHistoryState {
  return {
    schema: TIMELINE_HISTORY_SCHEMA,
    head_revision: headRevision,
    can_undo: false,
    can_redo: false,
    undo_count: 0,
    redo_count: 0,
    undo_revision: null,
    redo_revision: null,
  };
}

export function buildTimelineHistoryAction(
  baseRevision: number,
  action: TimelineHistoryAction,
  createdBy = 'operator',
) {
  return {
    schema: TIMELINE_HISTORY_SCHEMA,
    base_revision: baseRevision,
    action,
    created_by: createdBy,
  } as const;
}

export type HistoryShortcutInput = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  editingText?: boolean;
};

/** Platform-standard undo/redo shortcuts, ignored while typing in a field. */
export function historyShortcut(input: HistoryShortcutInput): TimelineHistoryAction | null {
  if (input.editingText || input.altKey || (!input.ctrlKey && !input.metaKey)) return null;
  const key = input.key.toLowerCase();
  if (key === 'z') return input.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !input.shiftKey) return 'redo';
  return null;
}
