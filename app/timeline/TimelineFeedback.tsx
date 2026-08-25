'use client';

import { useLanguage } from '../language';
import type { TimelineEditFeedback } from './use-timeline-editing';
import type { LocalizedText } from './types';

const TONE_ICON: Record<string, string> = { locked: 'L', invalid: '!', stale: '↻', offline: '⚡' };

export function TimelineFeedback({
  feedback,
  available,
  onRetry,
  onDismiss,
}: {
  feedback: TimelineEditFeedback;
  available: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const { t } = useLanguage();
  const say = (text: LocalizedText) => t(text.ko, text.en, text.zh, text.ja);

  // The strip always occupies its row so applying an edit never shifts the lanes.
  let tone = 'idle';
  let icon = 'i';
  let headline: string;
  let detail = '';

  if (!available) {
    tone = 'offline';
    icon = TONE_ICON.offline;
    headline = t(
      '타임라인 직접 편집은 데스크톱 앱에서 사용할 수 있습니다.',
      'Direct timeline editing is available in the desktop app.',
      '直接编辑时间线仅在桌面应用中可用。',
      'タイムラインの直接編集はデスクトップアプリで利用できます。',
    );
    detail = t(
      '브라우저 미리보기에서는 읽기 전용으로 표시됩니다.',
      'The browser preview shows the timeline read-only.',
      '浏览器预览中时间线为只读。',
      'ブラウザープレビューでは読み取り専用で表示されます。',
    );
  } else if (feedback.status === 'working') {
    tone = 'working';
    icon = '◐';
    headline = t(
      `${say(feedback.label)}을(를) 적용하는 중입니다…`,
      `Applying ${say(feedback.label).toLowerCase()}…`,
      `正在应用${say(feedback.label)}…`,
      `${say(feedback.label)}を適用しています…`,
    );
    detail = t(
      '완료될 때까지 새 편집은 잠시 기다립니다.',
      'New edits wait until this one finishes.',
      '在完成之前将暂停新的编辑。',
      '完了するまで新しい編集は待機します。',
    );
  } else if (feedback.status === 'applied') {
    tone = 'applied';
    icon = '✓';
    headline = t(
      `${say(feedback.label)}을(를) 적용했습니다.`,
      `${say(feedback.label)} applied.`,
      `已应用${say(feedback.label)}。`,
      `${say(feedback.label)}を適用しました。`,
    );
    detail = t(
      `새 버전 v${feedback.revision}으로 저장되었습니다. 이전 버전은 그대로 남아 있습니다.`,
      `Saved as new version v${feedback.revision}. Earlier versions are kept.`,
      `已保存为新版本 v${feedback.revision}，此前的版本仍然保留。`,
      `新しいバージョン v${feedback.revision} として保存しました。以前のバージョンは残ります。`,
    );
  } else if (feedback.status === 'failed') {
    tone = feedback.presentation.tone;
    icon = TONE_ICON[feedback.presentation.tone] ?? '!';
    headline = say(feedback.presentation.title);
    detail = say(feedback.presentation.detail);
  } else {
    headline = t(
      '클립을 선택해 옮기거나, 양쪽 끝을 끌어 길이를 조절하세요.',
      'Select a clip to move it, or drag either end to change its length.',
      '选择片段可移动，拖动两端可调整长度。',
      'クリップを選んで移動、両端をドラッグして長さを調整できます。',
    );
    detail = t(
      '모든 편집은 저장될 때마다 새 버전으로 남습니다.',
      'Every edit is stored as a new version.',
      '每次编辑都会保存为新版本。',
      '編集のたびに新しいバージョンとして保存されます。',
    );
  }

  return (
    <div className={`desktop-timeline-feedback tone-${tone}`} role="status" aria-live="polite">
      <span className="desktop-timeline-feedback-icon" aria-hidden="true">{icon}</span>
      <div>
        <b>{headline}</b>
        {detail ? <small>{detail}</small> : null}
      </div>
      {feedback.status === 'failed' && feedback.retryable ? (
        <button type="button" className="desktop-timeline-feedback-action" onClick={onRetry}>
          {t('다시 시도', 'Try again', '重试', '再試行')}
        </button>
      ) : null}
      {feedback.status === 'failed' ? (
        <button
          type="button"
          className="desktop-timeline-feedback-close"
          onClick={onDismiss}
          aria-label={t('알림 닫기', 'Dismiss message', '关闭提示', '通知を閉じる')}
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}
