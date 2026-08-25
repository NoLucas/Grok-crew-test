'use client';

// Exact-value editing for every P1-01 operation. This panel is the keyboard and
// screen-reader path: nothing here needs a drag, and each control says why it is
// unavailable instead of silently doing nothing.

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useLanguage } from '../language';
import { adjacentNeighbours, clipEnd, clipLabel, formatTimecode, roundTime } from './geometry';
import {
  buildMoveOperation,
  buildRippleOperation,
  buildRollOperation,
  buildSlideOperation,
  buildSlipOperation,
  buildSplitOperation,
  buildTrimOperation,
  isEditable,
} from './operations';
import type { BuildResult, TimelineOperation } from './operations';
import type { ClipLocation, Timeline, TimelineTrack } from './types';
import type { TimelineEditingController } from './use-timeline-editing';

type Draft = {
  start: string;
  trackId: string;
  trimStart: string;
  trimEnd: string;
  splitAt: string;
  rippleAt: string;
  rollSeam: 'previous' | 'next';
  rollAt: string;
  slipIn: string;
  slideStart: string;
};

function seconds(value: string, fallback: number) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? roundTime(parsed) : fallback;
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="desktop-precision-row">
      <span className="desktop-precision-label">{label}</span>
      <div className="desktop-precision-controls">{children}</div>
      {hint ? <small className="desktop-precision-hint">{hint}</small> : null}
    </div>
  );
}

export function TimelinePrecisionPanel({
  timeline,
  selected,
  playhead,
  onPlayheadChange,
  tracks,
  editing,
  disabled,
  onRun,
}: {
  timeline: Timeline;
  selected: ClipLocation | null;
  playhead: number;
  onPlayheadChange: (value: number) => void;
  tracks: TimelineTrack[];
  editing: TimelineEditingController;
  disabled: boolean;
  onRun: (result: BuildResult<TimelineOperation>) => void;
}) {
  const { t } = useLanguage();
  const clip = selected?.clip ?? null;
  const track = selected?.track ?? null;

  const neighbours = useMemo(
    () => (track && clip ? adjacentNeighbours(track, clip) : { previous: null, next: null }),
    [clip, track],
  );

  // The form is derived from the committed revision and only remembers the
  // fields the operator actually typed. Nothing has to be re-seeded by an
  // effect, so the numbers can never describe a revision that no longer exists.
  const seedKey = `${clip?.id ?? ''}:${timeline.revision}`;
  const [edits, setEdits] = useState<{ key: string; values: Partial<Draft> }>({ key: '', values: {} });

  const defaults: Draft = useMemo(() => {
    if (!clip || !track) {
      return {
        start: '0', trackId: '', trimStart: '0', trimEnd: '0', splitAt: '0',
        rippleAt: '0', rollSeam: 'next', rollAt: '0', slipIn: '0', slideStart: '0',
      };
    }
    const inset = Math.min(0.5, clip.duration / 4);
    return {
      start: String(clip.timeline_start),
      trackId: track.id,
      trimStart: String(roundTime(clip.timeline_start + inset)),
      trimEnd: String(roundTime(clipEnd(clip) - inset)),
      splitAt: String(roundTime(clip.timeline_start + clip.duration / 2)),
      rippleAt: String(roundTime(clipEnd(clip) - inset)),
      rollSeam: 'next',
      rollAt: String(roundTime(clipEnd(clip))),
      slipIn: String(clip.source_in ?? 0),
      slideStart: String(clip.timeline_start),
    };
  }, [clip, track]);

  const draft: Draft = { ...defaults, ...(edits.key === seedKey ? edits.values : {}) };
  const setDraftValues = (values: Partial<Draft>) =>
    setEdits((previous) => ({
      key: seedKey,
      values: { ...(previous.key === seedKey ? previous.values : {}), ...values },
    }));

  if (!clip || !track) {
    return (
      <aside className="desktop-precision" aria-label={t('정밀 편집', 'Precision editing', '精确编辑', '精密編集')}>
        <div className="desktop-precision-empty">
          <span aria-hidden="true">⌁</span>
          <b>{t('클립을 선택하세요', 'Select a clip', '请选择片段', 'クリップを選択してください')}</b>
          <p>
            {t(
              '타임라인에서 클립을 고르면 여기에서 정확한 시각으로 이동·자르기·분할을 할 수 있습니다.',
              'Pick a clip in the timeline to move, trim and split it at exact times here.',
              '在时间线中选择片段后，可在此按精确时间移动、裁剪和分割。',
              'タイムラインでクリップを選ぶと、ここで正確な時刻の移動・トリム・分割ができます。',
            )}
          </p>
        </div>
      </aside>
    );
  }

  const editable = isEditable(track, clip);
  const busy = disabled || !editable;
  const label = clipLabel(timeline, clip);
  const hasSource = typeof clip.source_in === 'number' && typeof clip.source_out === 'number';
  const canSlide = Boolean(neighbours.previous && neighbours.next);
  const rollPair = draft.rollSeam === 'previous'
    ? (neighbours.previous ? { left: neighbours.previous, right: clip } : null)
    : (neighbours.next ? { left: clip, right: neighbours.next } : null);
  const targetTracks = tracks.filter((item) => item.type === track.type && (!item.locked || item.id === track.id));

  const apply = t('적용', 'Apply', '应用', '適用');

  return (
    <aside className="desktop-precision" aria-label={t('정밀 편집', 'Precision editing', '精确编辑', '精密編集')}>
      <div className="desktop-precision-head">
        <b title={label}>{label}</b>
        <div className="desktop-precision-badges">
          <span>{track.name}</span>
          <span>{formatTimecode(clip.timeline_start)}–{formatTimecode(clipEnd(clip))}</span>
          {editable ? null : <span className="locked">{t('잠김', 'Locked', '已锁定', 'ロック中')}</span>}
        </div>
      </div>

      {!editable ? (
        <p className="desktop-precision-note">
          {t(
            '이 클립 또는 트랙이 잠겨 있어 편집할 수 없습니다. 트랙 머리의 L 버튼 또는 오른쪽 클립 속성에서 잠금을 해제하세요.',
            'This clip or its track is locked. Unlock it with the L button in the track header or in the clip inspector.',
            '该片段或轨道已锁定。请在轨道标题的 L 按钮或右侧片段属性中解锁。',
            'このクリップまたはトラックはロックされています。トラックヘッダーの L ボタンかクリップ属性で解除してください。',
          )}
        </p>
      ) : null}

      <div className="desktop-precision-body">
        <Row label={t('위치 이동', 'Move to', '移动到', '移動先')}>
          <input
            type="number" min="0" step="0.1" inputMode="decimal" disabled={busy}
            value={draft.start}
            aria-label={t('새 시작 시각(초)', 'New start time in seconds', '新的起始时间（秒）', '新しい開始時刻（秒）')}
            onChange={(event) => setDraftValues({ start: event.target.value })}
          />
          <select
            disabled={busy}
            value={draft.trackId}
            aria-label={t('대상 트랙', 'Target track', '目标轨道', '移動先トラック')}
            onChange={(event) => setDraftValues({ trackId: event.target.value })}
          >
            {targetTracks.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
          <button
            type="button" disabled={busy}
            onClick={() => onRun(buildMoveOperation(
              track, clip, seconds(draft.start, clip.timeline_start),
              tracks.find((item) => item.id === draft.trackId),
            ))}
          >
            {t('이동', 'Move', '移动', '移動')}
          </button>
        </Row>

        <Row
          label={t('시작 자르기', 'Trim start', '裁剪起点', '開始をトリム')}
          hint={t('클립 안쪽 시각만 넣을 수 있습니다. 자르기는 길이를 줄이기만 합니다.', 'Only a time inside the clip works: trimming shortens, never lengthens.', '只能输入片段内部的时间：裁剪只会缩短，不会加长。', 'クリップ内側の時刻のみ有効です。トリムは短くするだけです。')}
        >
          <input
            type="number" min="0" step="0.1" inputMode="decimal" disabled={busy}
            value={draft.trimStart}
            aria-label={t('새 시작 지점(초)', 'New start edge in seconds', '新的起点（秒）', '新しい開始位置（秒）')}
            onChange={(event) => setDraftValues({ trimStart: event.target.value })}
          />
          <button
            type="button" disabled={busy}
            onClick={() => onRun(buildTrimOperation(timeline, track, clip, 'start', seconds(draft.trimStart, clip.timeline_start)))}
          >
            {apply}
          </button>
        </Row>

        <Row
          label={t('끝 자르기', 'Trim end', '裁剪终点', '終了をトリム')}
          hint={t('길이를 늘리려면 롤 편집이나 오른쪽 클립 속성의 길이 값을 쓰세요.', 'To make a clip longer, use a roll edit or the duration field in the clip inspector.', '若要加长片段，请使用滚动编辑或右侧片段属性中的时长。', '長くするにはロール編集かクリップ属性の長さを使ってください。')}
        >
          <input
            type="number" min="0" step="0.1" inputMode="decimal" disabled={busy}
            value={draft.trimEnd}
            aria-label={t('새 끝 지점(초)', 'New end edge in seconds', '新的终点（秒）', '新しい終了位置（秒）')}
            onChange={(event) => setDraftValues({ trimEnd: event.target.value })}
          />
          <button
            type="button" disabled={busy}
            onClick={() => onRun(buildTrimOperation(timeline, track, clip, 'end', seconds(draft.trimEnd, clipEnd(clip))))}
          >
            {apply}
          </button>
        </Row>

        <Row
          label={t('리플 트림', 'Ripple trim', '波纹裁剪', 'リップルトリム')}
          hint={t('끝을 옮기고 같은 트랙의 뒤 클립을 같은 만큼 당깁니다.', 'Moves the end and pulls the later clips on this track by the same amount.', '移动终点并将该轨道后续片段同步前移。', '終端を動かし、同じトラックの後続クリップを同じ分だけ移動します。')}
        >
          <input
            type="number" min="0" step="0.1" inputMode="decimal" disabled={busy}
            value={draft.rippleAt}
            aria-label={t('리플 트림 지점(초)', 'Ripple trim point in seconds', '波纹裁剪位置（秒）', 'リップルトリム位置（秒）')}
            onChange={(event) => setDraftValues({ rippleAt: event.target.value })}
          />
          <button
            type="button" disabled={busy}
            onClick={() => onRun(buildRippleOperation(timeline, track, clip, seconds(draft.rippleAt, clipEnd(clip))))}
          >
            {apply}
          </button>
        </Row>

        <Row label={t('분할', 'Split', '分割', '分割')}>
          <input
            type="number" min="0" step="0.1" inputMode="decimal" disabled={busy}
            value={draft.splitAt}
            aria-label={t('분할 시각(초)', 'Split time in seconds', '分割时间（秒）', '分割時刻（秒）')}
            onChange={(event) => setDraftValues({ splitAt: event.target.value })}
          />
          <button
            type="button" className="desktop-precision-ghost" disabled={busy}
            onClick={() => setDraftValues({ splitAt: String(playhead) })}
          >
            {t('재생 위치', 'Playhead', '播放位置', '再生位置')}
          </button>
          <button
            type="button" disabled={busy}
            onClick={() => {
              const at = seconds(draft.splitAt, playhead);
              onPlayheadChange(at);
              onRun(buildSplitOperation(timeline, track, clip, at));
            }}
          >
            {t('분할', 'Split', '分割', '分割')}
          </button>
        </Row>

        <Row
          label={t('롤 편집', 'Roll edit', '滚动编辑', 'ロール編集')}
          hint={rollPair
            ? t('맞닿은 두 클립의 경계만 옮기고 전체 길이는 그대로 둡니다.', 'Moves the shared edit point and keeps the total length.', '仅移动两片段的交界点，总长度不变。', '接する 2 クリップの境界だけを動かし、全体の長さは保ちます。')
            : t('맞닿은 이웃 클립이 없어 롤 편집을 할 수 없습니다.', 'No touching neighbour, so roll is unavailable.', '没有相邻片段，无法进行滚动编辑。', '接する隣のクリップがないためロール編集はできません。')}
        >
          <select
            disabled={busy || !rollPair}
            value={draft.rollSeam}
            aria-label={t('롤 편집 경계', 'Roll edit point', '滚动编辑交界', 'ロール編集の境界')}
            onChange={(event) => {
              const rollSeam = event.target.value as 'previous' | 'next';
              const at = rollSeam === 'previous' ? clip.timeline_start : clipEnd(clip);
              setDraftValues({ rollSeam, rollAt: String(roundTime(at)) });
            }}
          >
            <option value="previous" disabled={!neighbours.previous}>{t('앞 경계', 'Left seam', '前交界', '前の境界')}</option>
            <option value="next" disabled={!neighbours.next}>{t('뒤 경계', 'Right seam', '后交界', '後の境界')}</option>
          </select>
          <input
            type="number" min="0" step="0.1" inputMode="decimal" disabled={busy || !rollPair}
            value={draft.rollAt}
            aria-label={t('새 편집점(초)', 'New edit point in seconds', '新的编辑点（秒）', '新しい編集点（秒）')}
            onChange={(event) => setDraftValues({ rollAt: event.target.value })}
          />
          <button
            type="button" disabled={busy || !rollPair}
            onClick={() => rollPair && onRun(buildRollOperation(
              timeline, track, rollPair.left, rollPair.right, seconds(draft.rollAt, clipEnd(rollPair.left)),
            ))}
          >
            {apply}
          </button>
        </Row>

        <Row
          label={t('슬립', 'Slip', '滑动素材', 'スリップ')}
          hint={hasSource
            ? t('클립 위치와 길이는 그대로, 보이는 원본 시작만 바꿉니다.', 'Keeps position and length, changes which part of the source plays.', '位置与长度不变，仅更换播放的素材起点。', '位置と長さはそのままで、再生される素材の開始位置だけ変えます。')
            : t('이 클립에는 원본 구간 정보가 없어 슬립을 할 수 없습니다.', 'This clip has no source range, so slip is unavailable.', '该片段没有素材区间信息，无法滑动素材。', 'このクリップには素材区間がないためスリップできません。')}
        >
          <input
            type="number" min="0" step="0.1" inputMode="decimal" disabled={busy || !hasSource}
            value={draft.slipIn}
            aria-label={t('새 원본 시작(초)', 'New source start in seconds', '新的素材起点（秒）', '新しい素材開始（秒）')}
            onChange={(event) => setDraftValues({ slipIn: event.target.value })}
          />
          <button
            type="button" disabled={busy || !hasSource}
            onClick={() => onRun(buildSlipOperation(timeline, track, clip, seconds(draft.slipIn, clip.source_in ?? 0)))}
          >
            {apply}
          </button>
        </Row>

        <Row
          label={t('슬라이드', 'Slide', '滑移', 'スライド')}
          hint={canSlide
            ? t('앞뒤 클립 길이를 맞바꾸며 이 클립만 옮깁니다.', 'Moves this clip by trading length between both neighbours.', '通过前后片段互换长度来移动此片段。', '前後のクリップの長さをやり取りしてこのクリップを移動します。')
            : t('앞뒤가 모두 맞닿아 있어야 슬라이드할 수 있습니다.', 'Slide needs a clip touching on both sides.', '滑移需要前后都紧贴的片段。', 'スライドは前後の両方が接している必要があります。')}
        >
          <input
            type="number" min="0" step="0.1" inputMode="decimal" disabled={busy || !canSlide}
            value={draft.slideStart}
            aria-label={t('새 시작 시각(초)', 'New start time in seconds', '新的起始时间（秒）', '新しい開始時刻（秒）')}
            onChange={(event) => setDraftValues({ slideStart: event.target.value })}
          />
          <button
            type="button" disabled={busy || !canSlide}
            onClick={() => onRun(buildSlideOperation(timeline, track, clip, seconds(draft.slideStart, clip.timeline_start)))}
          >
            {apply}
          </button>
        </Row>
      </div>

      {editing.pending ? (
        <p className="desktop-precision-note busy">
          {t('편집을 적용하는 중입니다…', 'Applying the edit…', '正在应用编辑…', '編集を適用しています…')}
        </p>
      ) : null}
    </aside>
  );
}
