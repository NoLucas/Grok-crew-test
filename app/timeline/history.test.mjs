import assert from 'node:assert/strict';
import { register } from 'node:module';
import { describe, it } from 'node:test';

register('./ts-resolver.helper.mjs', import.meta.url);

const {
  TIMELINE_HISTORY_SCHEMA,
  buildTimelineHistoryAction,
  emptyTimelineHistory,
  historyShortcut,
} = await import('./history.ts');

describe('timeline history contract', () => {
  it('builds the frozen undo and redo request shape', () => {
    assert.deepEqual(buildTimelineHistoryAction(7, 'undo'), {
      schema: TIMELINE_HISTORY_SCHEMA,
      base_revision: 7,
      action: 'undo',
      created_by: 'operator',
    });
    assert.deepEqual(buildTimelineHistoryAction(8, 'redo', 'editor'), {
      schema: 'grok-crew.timeline-history/v1',
      base_revision: 8,
      action: 'redo',
      created_by: 'editor',
    });
  });

  it('starts with no available history actions', () => {
    assert.deepEqual(emptyTimelineHistory(3), {
      schema: 'grok-crew.timeline-history/v1',
      head_revision: 3,
      can_undo: false,
      can_redo: false,
      undo_count: 0,
      redo_count: 0,
      undo_revision: null,
      redo_revision: null,
    });
  });
});

describe('timeline history keyboard shortcuts', () => {
  it('supports platform undo and redo shortcuts', () => {
    assert.equal(historyShortcut({ key: 'z', ctrlKey: true }), 'undo');
    assert.equal(historyShortcut({ key: 'Z', metaKey: true }), 'undo');
    assert.equal(historyShortcut({ key: 'z', ctrlKey: true, shiftKey: true }), 'redo');
    assert.equal(historyShortcut({ key: 'y', ctrlKey: true }), 'redo');
  });

  it('does not steal shortcuts from text editing or unrelated chords', () => {
    assert.equal(historyShortcut({ key: 'z' }), null);
    assert.equal(historyShortcut({ key: 'z', ctrlKey: true, editingText: true }), null);
    assert.equal(historyShortcut({ key: 'z', ctrlKey: true, altKey: true }), null);
    assert.equal(historyShortcut({ key: 'y', ctrlKey: true, shiftKey: true }), null);
    assert.equal(historyShortcut({ key: 'a', ctrlKey: true }), null);
  });
});
