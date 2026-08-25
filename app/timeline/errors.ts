// Maps the frozen timeline patch error contract onto plain-language feedback.
// Pure: no React, no DOM. The component decides where to show the result.

import type { LocalizedText } from './types';

export type TimelineErrorTone = 'locked' | 'invalid' | 'stale' | 'offline';

/** What the UI must do after the failure, so no caller invents its own recovery. */
export type TimelineErrorRecovery =
  /** Reload the project and tell the user their unapplied change was dropped. */
  | 'reload_timeline'
  /** Keep the current revision on screen; the edit simply did not happen. */
  | 'keep_revision'
  /** Same as keep, plus offer to send the identical edit again. */
  | 'retry';

export type TimelinePatchFailure = {
  code: string;
  message: string;
  details: Record<string, unknown>;
};

export type TimelineErrorPresentation = {
  code: string;
  tone: TimelineErrorTone;
  recovery: TimelineErrorRecovery;
  title: LocalizedText;
  detail: LocalizedText;
};

function detailNumber(details: Record<string, unknown>, key: string) {
  const value = details[key];
  return typeof value === 'number' ? value : null;
}

function detailText(details: Record<string, unknown>, key: string) {
  const value = details[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

const GENERIC_INVALID: LocalizedText = {
  ko: '이 편집은 적용할 수 없어 이전 상태를 그대로 두었습니다.',
  en: 'This edit could not be applied, so the previous state was kept.',
  zh: '此编辑无法应用，已保留原有状态。',
  ja: 'この編集は適用できないため、直前の状態を保持しました。',
};

/**
 * Turn a patch failure into a message a non-developer can act on.
 * Unknown codes still produce a safe, honest message instead of raw JSON.
 */
export function presentTimelineError(failure: TimelinePatchFailure): TimelineErrorPresentation {
  const { code, details } = failure;
  const clipId = detailText(details, 'clip_id');

  switch (code) {
    case 'stale_timeline_revision': {
      const expected = detailNumber(details, 'expected_revision');
      const suffix = expected === null ? '' : ` (v${expected})`;
      return {
        code,
        tone: 'stale',
        recovery: 'reload_timeline',
        title: {
          ko: '타임라인이 그 사이에 바뀌었습니다',
          en: 'The timeline changed in the meantime',
          zh: '时间线在此期间已更改',
          ja: 'その間にタイムラインが変更されました',
        },
        detail: {
          ko: `최신 버전${suffix}을 다시 불러왔고, 방금 시도한 편집은 적용하지 않았습니다. 화면을 확인한 뒤 다시 편집해 주세요.`,
          en: `The latest version${suffix} was reloaded and the edit you just tried was not applied. Check the timeline and edit again.`,
          zh: `已重新载入最新版本${suffix}，刚才尝试的编辑未被应用。请确认后重新编辑。`,
          ja: `最新バージョン${suffix}を読み込み直し、今の編集は適用していません。画面を確認してからもう一度編集してください。`,
        },
      };
    }
    case 'timeline_item_locked': {
      const trackId = detailText(details, 'track_id');
      const target = clipId ?? trackId ?? '';
      return {
        code,
        tone: 'locked',
        recovery: 'keep_revision',
        title: {
          ko: '잠긴 항목은 편집할 수 없습니다',
          en: 'Locked items cannot be edited',
          zh: '锁定的项目无法编辑',
          ja: 'ロックされた項目は編集できません',
        },
        detail: {
          ko: `${target ? `${target}은(는) ` : ''}잠겨 있어 그대로 두었습니다. 트랙 머리의 잠금 버튼이나 클립 속성의 잠금 해제 후 다시 시도하세요.`,
          en: `${target ? `${target} is ` : 'It is '}locked and was left untouched. Unlock it in the track header or the clip inspector, then try again.`,
          zh: `${target ? `${target} ` : ''}已锁定，因此保持不变。请在轨道标题或片段属性中解锁后重试。`,
          ja: `${target ? `${target} は` : ''}ロックされているため変更していません。トラックヘッダーまたはクリップ属性でロックを解除してから再試行してください。`,
        },
      };
    }
    case 'invalid_time_range':
      return {
        code,
        tone: 'invalid',
        recovery: 'keep_revision',
        title: {
          ko: '이 위치에서는 편집할 수 없습니다',
          en: 'That position is not a valid edit point',
          zh: '该位置无法进行编辑',
          ja: 'この位置では編集できません',
        },
        detail: {
          ko: '자르기·분할 지점은 클립 안쪽이어야 하고, 편집 후에도 모든 클립의 길이가 0보다 커야 합니다.',
          en: 'A trim or split point must sit inside the clip, and every clip must stay longer than zero afterwards.',
          zh: '裁剪或分割点必须位于片段内部，且编辑后每个片段的长度都要大于零。',
          ja: 'トリムや分割の位置はクリップの内側である必要があり、編集後もすべてのクリップの長さが 0 より大きい必要があります。',
        },
      };
    case 'invalid_source_range':
      return {
        code,
        tone: 'invalid',
        recovery: 'keep_revision',
        title: {
          ko: '원본 구간을 사용할 수 없습니다',
          en: 'That source range cannot be used',
          zh: '无法使用该素材区间',
          ja: '元素材の区間を使用できません',
        },
        detail: {
          ko: '이 클립에는 사용할 원본 시작·끝이 함께 필요하고, 끝이 시작보다 뒤여야 합니다. 슬립은 원본 구간이 있는 클립에서만 됩니다.',
          en: 'The clip needs both a source start and end, with the end after the start. Slip only works on clips that carry a source range.',
          zh: '该片段需要同时具备素材起点和终点，且终点要晚于起点。滑动素材仅适用于带素材区间的片段。',
          ja: 'このクリップには元素材の開始と終了の両方が必要で、終了は開始より後である必要があります。スリップは元素材区間を持つクリップでのみ使えます。',
        },
      };
    case 'source_range_exceeds_asset': {
      const assetSeconds = detailNumber(details, 'asset_duration');
      const limit = assetSeconds === null ? '' : ` (${assetSeconds.toFixed(1)}s)`;
      return {
        code,
        tone: 'invalid',
        recovery: 'keep_revision',
        title: {
          ko: '원본 길이를 넘었습니다',
          en: 'That goes past the end of the source',
          zh: '超出了素材长度',
          ja: '元素材の長さを超えています',
        },
        detail: {
          ko: `원본 파일${limit}에 없는 구간은 사용할 수 없습니다. 조금 안쪽으로 조정해 주세요.`,
          en: `The source file${limit} does not contain that range. Pull the edit slightly back inside it.`,
          zh: `素材文件${limit}中不存在该区间，请稍微向内调整。`,
          ja: `元ファイル${limit}に存在しない区間は使えません。少し内側に調整してください。`,
        },
      };
    }
    case 'clips_not_adjacent':
      return {
        code,
        tone: 'invalid',
        recovery: 'keep_revision',
        title: {
          ko: '두 클립이 맞닿아 있어야 합니다',
          en: 'The clips have to touch',
          zh: '两个片段必须相邻',
          ja: '2 つのクリップが接している必要があります',
        },
        detail: {
          ko: '롤 편집은 맞닿은 두 클립의 경계에서만, 슬라이드는 앞뒤 클립이 모두 붙어 있을 때만 됩니다. 사이의 빈 공간을 먼저 없애 주세요.',
          en: 'Roll works only on the seam between two touching clips, and slide needs a clip touching on both sides. Close the gap first.',
          zh: '滚动编辑仅适用于两个相邻片段的交界处，滑动则需要前后都紧贴。请先消除中间的空隙。',
          ja: 'ロール編集は接した 2 つのクリップの境界でのみ、スライドは前後のクリップが両方接している場合のみ行えます。先に間の空きを詰めてください。',
        },
      };
    case 'clips_on_different_tracks':
      return {
        code,
        tone: 'invalid',
        recovery: 'keep_revision',
        title: {
          ko: '같은 트랙의 클립이어야 합니다',
          en: 'The clips must be on one track',
          zh: '片段必须位于同一轨道',
          ja: '同じトラックのクリップである必要があります',
        },
        detail: {
          ko: '롤과 슬라이드는 한 트랙 안에서만 동작합니다. 같은 줄에 있는 클립을 선택해 주세요.',
          en: 'Roll and slide work within a single track. Pick clips that sit on the same row.',
          zh: '滚动和滑动仅在同一轨道内有效，请选择同一行的片段。',
          ja: 'ロールとスライドは 1 つのトラック内でのみ動作します。同じ行のクリップを選んでください。',
        },
      };
    case 'timeline_item_not_found':
      return {
        code,
        tone: 'stale',
        recovery: 'reload_timeline',
        title: {
          ko: '대상을 찾지 못했습니다',
          en: 'That item is no longer there',
          zh: '未找到该项目',
          ja: '対象が見つかりません',
        },
        detail: {
          ko: `${clipId ? `${clipId}이(가) ` : '선택한 항목이 '}타임라인에 없습니다. 최신 상태를 다시 불러왔습니다.`,
          en: `${clipId ? `${clipId} is ` : 'The selected item is '}not in the timeline any more. The latest state was reloaded.`,
          zh: `${clipId ? `${clipId} ` : '所选项目'}已不在时间线中，已重新载入最新状态。`,
          ja: `${clipId ? `${clipId} は` : '選択した項目は'}タイムラインにありません。最新の状態を読み込み直しました。`,
        },
      };
    case 'timeline_patch_transport_error':
      return {
        code,
        tone: 'offline',
        recovery: 'retry',
        title: {
          ko: '편집 서비스에 연결하지 못했습니다',
          en: 'Could not reach the editing service',
          zh: '无法连接编辑服务',
          ja: '編集サービスに接続できませんでした',
        },
        detail: {
          ko: '이 PC의 Local Studio가 응답하지 않아 편집을 보내지 못했습니다. 타임라인은 그대로입니다. 잠시 후 다시 시도해 주세요.',
          en: 'Local Studio on this PC did not respond, so the edit was not sent. The timeline is unchanged — try again in a moment.',
          zh: '本机的 Local Studio 未响应，编辑未发送。时间线保持不变，请稍后重试。',
          ja: 'この PC の Local Studio が応答しないため編集を送信できませんでした。タイムラインは変わっていません。少し待って再試行してください。',
        },
      };
    case 'timeline_patch_too_large':
    case 'too_many_operations':
      return {
        code,
        tone: 'invalid',
        recovery: 'keep_revision',
        title: {
          ko: '한 번에 보내기에는 편집이 너무 많습니다',
          en: 'Too many changes in one request',
          zh: '一次提交的更改过多',
          ja: '一度に送るには編集が多すぎます',
        },
        detail: {
          ko: '편집을 나누어 다시 시도해 주세요. 타임라인은 그대로 두었습니다.',
          en: 'Split the work into smaller edits and try again. The timeline was left unchanged.',
          zh: '请将编辑拆分后重试，时间线保持不变。',
          ja: '編集を分けて再試行してください。タイムラインは変更していません。',
        },
      };
    case 'invalid_operation':
    case 'unsupported_operation':
    case 'invalid_patch':
    case 'invalid_patch_schema':
    case 'invalid_patch_origin':
    case 'invalid_base_revision':
    case 'invalid_operations':
    case 'invalid_project_id':
      return {
        code,
        tone: 'invalid',
        recovery: 'keep_revision',
        title: {
          ko: '이 편집은 보낼 수 없습니다',
          en: 'This edit could not be sent',
          zh: '无法提交此编辑',
          ja: 'この編集は送信できません',
        },
        detail: GENERIC_INVALID,
      };
    default:
      return {
        code: code || 'timeline_patch_failed',
        tone: 'invalid',
        recovery: 'keep_revision',
        title: {
          ko: '편집을 적용하지 못했습니다',
          en: 'The edit was not applied',
          zh: '编辑未能应用',
          ja: '編集を適用できませんでした',
        },
        detail: GENERIC_INVALID,
      };
  }
}

/** Locally detected blocks reuse the same vocabulary, so the wording never drifts. */
export function presentEditBlock(block: { code: string; details: Record<string, unknown> }) {
  return presentTimelineError({ code: block.code, message: block.code, details: block.details });
}
