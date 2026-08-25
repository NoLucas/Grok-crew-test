'use client';

// One request queue, one feedback surface, one place that turns a built
// operation into a patch against the revision currently on screen.

import { useCallback, useMemo, useRef, useState } from 'react';
import { presentEditBlock, presentTimelineError } from './errors';
import type { TimelineErrorPresentation } from './errors';
import { buildTimelinePatch } from './operations';
import type { EditBlock, TimelineOperation } from './operations';
import { sendTimelinePatch } from './patch-client';
import type { ApplyTimelinePatchBridge } from './patch-client';
import type { LocalizedText, Timeline, TimelineVersion } from './types';

export type TimelineEditFeedback =
  | { status: 'idle' }
  | { status: 'working'; label: LocalizedText }
  | { status: 'applied'; label: LocalizedText; revision: number }
  | { status: 'failed'; presentation: TimelineErrorPresentation; retryable: boolean };

export type TimelineEditingArgs = {
  projectId: string;
  timeline: Timeline | null;
  createdBy: string;
  bridge: ApplyTimelinePatchBridge | undefined;
  /** Called with the new immutable revision returned by the sidecar. */
  onApplied: (timeline: Timeline, version: TimelineVersion) => void;
  /** Called when the server state moved on and the screen has to catch up. */
  onReloadRequired: () => void | Promise<void>;
};

export const OPERATION_LABELS: Record<TimelineOperation['op'], LocalizedText> = {
  move_clip: { ko: '클립 이동', en: 'Move clip', zh: '移动片段', ja: 'クリップ移動' },
  trim_clip: { ko: '길이 조절', en: 'Trim clip', zh: '调整长度', ja: 'トリム' },
  split_clip: { ko: '클립 분할', en: 'Split clip', zh: '分割片段', ja: 'クリップ分割' },
  ripple_trim: { ko: '리플 트림', en: 'Ripple trim', zh: '波纹裁剪', ja: 'リップルトリム' },
  roll_edit: { ko: '롤 편집', en: 'Roll edit', zh: '滚动编辑', ja: 'ロール編集' },
  slip_clip: { ko: '슬립', en: 'Slip clip', zh: '滑动素材', ja: 'スリップ' },
  slide_clip: { ko: '슬라이드', en: 'Slide clip', zh: '滑移片段', ja: 'スライド' },
};

export function useTimelineEditing({
  projectId,
  timeline,
  createdBy,
  bridge,
  onApplied,
  onReloadRequired,
}: TimelineEditingArgs) {
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<TimelineEditFeedback>({ status: 'idle' });
  // A ref guards the queue: React state updates are async and a fast second
  // pointer release would otherwise slip a duplicate patch through.
  const inFlight = useRef(false);
  const lastOperation = useRef<TimelineOperation | null>(null);

  const dismissFeedback = useCallback(() => setFeedback({ status: 'idle' }), []);

  const reportBlock = useCallback((block: EditBlock) => {
    setFeedback({ status: 'failed', presentation: presentEditBlock(block), retryable: false });
  }, []);

  const submit = useCallback(
    async (operation: TimelineOperation): Promise<boolean> => {
      if (inFlight.current || !timeline || !projectId) return false;
      inFlight.current = true;
      lastOperation.current = operation;
      const label = OPERATION_LABELS[operation.op];
      setPending(true);
      setFeedback({ status: 'working', label });
      try {
        const outcome = await sendTimelinePatch(
          bridge,
          projectId,
          buildTimelinePatch(timeline.revision, createdBy, [operation]),
        );
        if (outcome.ok) {
          onApplied(outcome.value.timeline, outcome.value.version);
          setFeedback({ status: 'applied', label, revision: outcome.value.timeline.revision });
          return true;
        }
        const presentation = presentTimelineError(outcome.error);
        setFeedback({ status: 'failed', presentation, retryable: presentation.recovery === 'retry' });
        if (presentation.recovery === 'reload_timeline') await onReloadRequired();
        return false;
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [bridge, createdBy, onApplied, onReloadRequired, projectId, timeline],
  );

  const retryLast = useCallback(() => {
    const operation = lastOperation.current;
    if (operation) void submit(operation);
  }, [submit]);

  return useMemo(
    () => ({
      /** False in the browser preview: the bridge only exists in the desktop app. */
      available: Boolean(bridge),
      pending,
      feedback,
      submit,
      reportBlock,
      retryLast,
      dismissFeedback,
    }),
    [bridge, dismissFeedback, feedback, pending, reportBlock, retryLast, submit],
  );
}

export type TimelineEditingController = ReturnType<typeof useTimelineEditing>;
