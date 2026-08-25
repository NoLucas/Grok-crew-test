'use client';

// The bottom timeline: select, move, trim, split, ripple, roll, slip and slide
// a clip directly, with the same operations reachable by keyboard and by exact
// numbers in the side panel.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useLanguage } from '../language';
import { TimelineFeedback } from './TimelineFeedback';
import { TimelinePrecisionPanel } from './TimelinePrecisionPanel';
import {
  NUDGE_STEP,
  NUDGE_STEP_LARGE,
  adjacentNeighbours,
  canDropOnTrack,
  clampTime,
  clipEnd,
  clipLabel,
  findClip,
  formatTimecode,
  orderedTracks,
  pixelsToSeconds,
  roundTime,
  secondsToPercent,
  timelineDuration,
} from './geometry';
import {
  buildMoveOperation,
  buildRippleOperation,
  buildRollOperation,
  buildSlideOperation,
  buildSlipOperation,
  buildSplitOperation,
  buildTrimOperation,
  clampRollBoundary,
  clampSlideStart,
  clampSlipSourceIn,
  clampTrimEdge,
  isEditable,
} from './operations';
import type { BuildResult, TimelineOperation } from './operations';
import { isPreviewTarget, moveTargetTrackId, previewRect } from './preview';
import type { DragPreview } from './preview';
import type { Timeline, TimelineClip, TimelineTrack, TrackType } from './types';
import type { TimelineEditingController } from './use-timeline-editing';

export type EditTool = 'select' | 'ripple' | 'slip' | 'slide';

type DragSession = {
  pointerId: number;
  kind: 'move' | 'trim-start' | 'trim-end' | 'slip' | 'slide' | 'roll';
  clipId: string;
  secondaryClipId?: string;
  trackId: string;
  startX: number;
  laneLeft: number;
  laneWidth: number;
  lanes: Array<{ trackId: string; top: number; bottom: number }>;
  moved: boolean;
  /**
   * The authoritative draft. React may still be batching the `preview` state
   * when the pointer is released, so the commit reads the ref, never the state.
   */
  draft: DragPreview | null;
};

/** Headroom so a clip can always be dragged past the current last frame. */
const SCALE_HEADROOM = 1.08;

export function TimelineEditor({
  timeline,
  selectedClipId,
  onSelectClip,
  editing,
  onAddTrack,
  onToggleTrack,
  trackBusy,
}: {
  timeline: Timeline;
  selectedClipId: string;
  onSelectClip: (clipId: string) => void;
  editing: TimelineEditingController;
  onAddTrack: (type: TrackType) => void;
  onToggleTrack: (track: TimelineTrack, field: 'locked' | 'muted') => void;
  trackBusy: boolean;
}) {
  const { t } = useLanguage();
  const [tool, setTool] = useState<EditTool>('select');
  const [playhead, setPlayhead] = useState(0);
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const session = useRef<DragSession | null>(null);
  const laneRefs = useRef(new Map<string, HTMLDivElement>());

  const scale = useMemo(() => Math.max(10, timelineDuration(timeline) * SCALE_HEADROOM), [timeline]);
  const tracks = useMemo(() => orderedTracks(timeline), [timeline]);
  const selected = useMemo(() => findClip(timeline, selectedClipId), [timeline, selectedClipId]);
  const locked = editing.pending || !editing.available;

  // Selecting a clip pulls the playhead into it when it sits elsewhere, so the
  // split and trim shortcuts always start from a point inside the clip.
  const selectClip = useCallback(
    (clipId: string) => {
      onSelectClip(clipId);
      const location = findClip(timeline, clipId);
      if (!location) return;
      const { clip } = location;
      setPlayhead((current) =>
        current > clip.timeline_start && current < clipEnd(clip)
          ? current
          : roundTime(clip.timeline_start + clip.duration / 2),
      );
    },
    [onSelectClip, timeline],
  );

  const run = useCallback(
    async (result: BuildResult<TimelineOperation>) => {
      if (!result.ok) {
        editing.reportBlock(result.block);
        return;
      }
      await editing.submit(result.value);
    },
    [editing],
  );

  // --- pointer dragging ------------------------------------------------------

  const beginDrag = useCallback(
    (
      event: ReactPointerEvent<HTMLElement>,
      kind: DragSession['kind'],
      track: TimelineTrack,
      clip: TimelineClip,
      secondaryClipId?: string,
    ) => {
      if (locked || event.button !== 0) return;
      const lane = laneRefs.current.get(track.id);
      if (!lane) return;
      const bounds = lane.getBoundingClientRect();
      session.current = {
        pointerId: event.pointerId,
        kind,
        clipId: clip.id,
        secondaryClipId,
        trackId: track.id,
        startX: event.clientX,
        laneLeft: bounds.left,
        laneWidth: bounds.width,
        lanes: [...laneRefs.current.entries()].map(([trackId, element]) => {
          const rect = element.getBoundingClientRect();
          return { trackId, top: rect.top, bottom: rect.bottom };
        }),
        moved: false,
        draft: null,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.stopPropagation();
    },
    [locked],
  );

  const updateDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const active = session.current;
      if (!active || active.pointerId !== event.pointerId) return;
      const stage = (draft: DragPreview | null) => {
        active.draft = draft;
        setPreview(draft);
      };
      const delta = pixelsToSeconds(event.clientX - active.startX, active.laneWidth, scale);
      if (!active.moved && Math.abs(event.clientX - active.startX) < 3) return;
      active.moved = true;

      const track = timeline.tracks.find((item) => item.id === active.trackId);
      const clip = track?.clips.find((item) => item.id === active.clipId);
      if (!track || !clip) return;

      if (active.kind === 'move') {
        const lane = active.lanes.find((item) => event.clientY >= item.top && event.clientY <= item.bottom);
        const candidate = lane ? timeline.tracks.find((item) => item.id === lane.trackId) : undefined;
        const target = candidate && canDropOnTrack(track, candidate) ? candidate : track;
        stage({
          kind: 'move',
          clipId: clip.id,
          fromTrackId: track.id,
          toTrackId: target.id,
          timelineStart: roundTime(clampTime(clip.timeline_start + delta, 0)),
        });
        return;
      }
      if (active.kind === 'trim-start' || active.kind === 'trim-end') {
        const edge = active.kind === 'trim-start' ? 'start' : 'end';
        const raw = edge === 'start' ? clip.timeline_start + delta : clipEnd(clip) + delta;
        const at = clampTrimEdge(clip, edge, raw);
        stage(
          tool === 'ripple' && edge === 'end'
            ? { kind: 'ripple', clipId: clip.id, at }
            : { kind: 'trim', clipId: clip.id, edge, at },
        );
        return;
      }
      if (active.kind === 'roll') {
        const right = track.clips.find((item) => item.id === active.secondaryClipId);
        if (!right) return;
        stage({
          kind: 'roll',
          leftClipId: clip.id,
          rightClipId: right.id,
          at: clampRollBoundary(clip, right, clipEnd(clip) + delta),
        });
        return;
      }
      if (active.kind === 'slip') {
        const sourceIn = clampSlipSourceIn(timeline, clip, (clip.source_in ?? 0) - delta);
        stage({ kind: 'slip', clipId: clip.id, sourceIn, delta: sourceIn - (clip.source_in ?? 0) });
        return;
      }
      const { previous, next } = adjacentNeighbours(track, clip);
      if (!previous || !next) {
        stage(null);
        return;
      }
      stage({
        kind: 'slide',
        clipId: clip.id,
        previousClipId: previous.id,
        nextClipId: next.id,
        timelineStart: clampSlideStart(previous, clip, next, clip.timeline_start + delta),
      });
    },
    [scale, timeline, tool],
  );

  const buildFromPreview = useCallback(
    (draft: DragPreview): BuildResult<TimelineOperation> | null => {
      const anchorId = draft.kind === 'roll' ? draft.leftClipId : draft.clipId;
      const location = findClip(timeline, anchorId);
      if (!location) return { ok: false, block: { code: 'timeline_item_not_found', details: { clip_id: anchorId } } };
      const { track, clip } = location;

      switch (draft.kind) {
        case 'move': {
          const target = timeline.tracks.find((item) => item.id === draft.toTrackId);
          const unchanged =
            draft.toTrackId === track.id && Math.abs(draft.timelineStart - clip.timeline_start) < 1e-4;
          return unchanged ? null : buildMoveOperation(track, clip, draft.timelineStart, target);
        }
        case 'trim': {
          const current = draft.edge === 'start' ? clip.timeline_start : clipEnd(clip);
          return Math.abs(draft.at - current) < 1e-4
            ? null
            : buildTrimOperation(timeline, track, clip, draft.edge, draft.at);
        }
        case 'ripple':
          return Math.abs(draft.at - clipEnd(clip)) < 1e-4
            ? null
            : buildRippleOperation(timeline, track, clip, draft.at);
        case 'roll': {
          const right = track.clips.find((item) => item.id === draft.rightClipId);
          if (!right) {
            return { ok: false, block: { code: 'timeline_item_not_found', details: { clip_id: draft.rightClipId } } };
          }
          return Math.abs(draft.at - clipEnd(clip)) < 1e-4
            ? null
            : buildRollOperation(timeline, track, clip, right, draft.at);
        }
        case 'slide':
          return Math.abs(draft.timelineStart - clip.timeline_start) < 1e-4
            ? null
            : buildSlideOperation(timeline, track, clip, draft.timelineStart);
        case 'slip':
          return Math.abs(draft.sourceIn - (clip.source_in ?? 0)) < 1e-4
            ? null
            : buildSlipOperation(timeline, track, clip, draft.sourceIn);
      }
    },
    [timeline],
  );

  const endDrag = useCallback(
    async (event: ReactPointerEvent<HTMLElement>) => {
      const active = session.current;
      if (!active || active.pointerId !== event.pointerId) return;
      session.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const draft = active.draft;
      if (!active.moved || !draft) {
        setPreview(null);
        // A slide needs a clip touching on both sides; say so instead of doing nothing.
        if (active.moved && active.kind === 'slide') {
          editing.reportBlock({ code: 'clips_not_adjacent', details: { clip_id: active.clipId } });
        }
        return;
      }
      const result = buildFromPreview(draft);
      try {
        // The preview stays on screen while the single patch is in flight. It is
        // never written into `timeline`, so a failure simply reveals the
        // committed revision again.
        if (result) await run(result);
      } finally {
        setPreview(null);
      }
    },
    [buildFromPreview, editing, run],
  );

  // Releasing the pointer outside the window must not leave a stale preview.
  useEffect(() => {
    const cancel = () => {
      if (!session.current) return;
      session.current = null;
      setPreview(null);
    };
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
    };
  }, []);

  // --- keyboard --------------------------------------------------------------

  const nudge = useCallback(
    (track: TimelineTrack, clip: TimelineClip, seconds: number) => {
      if (tool === 'slip') {
        void run(buildSlipOperation(timeline, track, clip, clampSlipSourceIn(timeline, clip, (clip.source_in ?? 0) - seconds)));
        return;
      }
      if (tool === 'slide') {
        const { previous, next } = adjacentNeighbours(track, clip);
        if (!previous || !next) {
          void run(buildSlideOperation(timeline, track, clip, clip.timeline_start + seconds));
          return;
        }
        void run(
          buildSlideOperation(
            timeline,
            track,
            clip,
            clampSlideStart(previous, clip, next, clip.timeline_start + seconds),
          ),
        );
        return;
      }
      void run(buildMoveOperation(track, clip, Math.max(0, roundTime(clip.timeline_start + seconds))));
    },
    [run, timeline, tool],
  );

  const moveToNeighbourTrack = useCallback(
    (track: TimelineTrack, clip: TimelineClip, direction: -1 | 1) => {
      const index = tracks.findIndex((item) => item.id === track.id);
      for (let step = index + direction; step >= 0 && step < tracks.length; step += direction) {
        if (canDropOnTrack(track, tracks[step])) {
          void run(buildMoveOperation(track, clip, clip.timeline_start, tracks[step]));
          return;
        }
      }
      editing.reportBlock({ code: 'invalid_operation', details: { field: 'track_id', clip_id: clip.id } });
    },
    [editing, run, tracks],
  );

  const onClipKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, track: TimelineTrack, clip: TimelineClip) => {
      if (locked) return;
      const step = event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          nudge(track, clip, -step);
          return;
        case 'ArrowRight':
          event.preventDefault();
          nudge(track, clip, step);
          return;
        case 'ArrowUp':
          event.preventDefault();
          moveToNeighbourTrack(track, clip, -1);
          return;
        case 'ArrowDown':
          event.preventDefault();
          moveToNeighbourTrack(track, clip, 1);
          return;
        case '[':
          event.preventDefault();
          void run(buildTrimOperation(timeline, track, clip, 'start', playhead));
          return;
        case ']':
          event.preventDefault();
          void run(
            event.shiftKey
              ? buildRippleOperation(timeline, track, clip, playhead)
              : buildTrimOperation(timeline, track, clip, 'end', playhead),
          );
          return;
        case 's':
        case 'S':
          event.preventDefault();
          void run(buildSplitOperation(timeline, track, clip, playhead));
          return;
        default:
      }
    },
    [locked, moveToNeighbourTrack, nudge, playhead, run, timeline],
  );

  const onHandleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, track: TimelineTrack, clip: TimelineClip, edge: 'start' | 'end') => {
      if (locked) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      event.stopPropagation();
      const step = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP);
      const current = edge === 'start' ? clip.timeline_start : clipEnd(clip);
      const at = clampTrimEdge(clip, edge, current + step);
      void run(
        tool === 'ripple' && edge === 'end'
          ? buildRippleOperation(timeline, track, clip, at)
          : buildTrimOperation(timeline, track, clip, edge, at),
      );
    },
    [locked, run, timeline, tool],
  );

  // --- render ----------------------------------------------------------------

  const toolOptions: Array<{ id: EditTool; label: string; hint: string }> = [
    {
      id: 'select',
      label: t('선택·이동', 'Select', '选择·移动', '選択・移動'),
      hint: t('클립을 끌어 옮기고, 양 끝을 안쪽으로 끌어 길이를 줄입니다.', 'Drag to move, and drag either end inward to shorten.', '拖动移动，向内拖动两端可缩短。', 'ドラッグで移動し、両端を内側にドラッグして短くします。'),
    },
    {
      id: 'ripple',
      label: t('리플', 'Ripple', '波纹', 'リップル'),
      hint: t('끝을 줄이면 뒤 클립이 같이 당겨집니다.', 'Trimming the end pulls the later clips along.', '缩短末端时后续片段会一起移动。', '終端を詰めると後続クリップも一緒に動きます。'),
    },
    {
      id: 'slip',
      label: t('슬립', 'Slip', '滑动素材', 'スリップ'),
      hint: t('클립은 그대로 두고 보이는 원본 구간만 바꿉니다.', 'Keeps the clip in place and changes which frames play.', '片段位置不变，只更换播放的素材区间。', 'クリップはそのままで、再生される素材区間だけ変えます。'),
    },
    {
      id: 'slide',
      label: t('슬라이드', 'Slide', '滑移', 'スライド'),
      hint: t('앞뒤 클립 길이를 바꿔가며 이 클립을 옮깁니다.', 'Moves the clip by trading length with both neighbours.', '通过调整前后片段长度来移动此片段。', '前後のクリップの長さを調整しながら移動します。'),
    },
  ];
  const activeHint = toolOptions.find((option) => option.id === tool)?.hint ?? '';

  const renderClip = (track: TimelineTrack, clip: TimelineClip) => {
    const rect = previewRect(preview, track, clip);
    const isSelected = clip.id === selectedClipId;
    const editable = isEditable(track, clip);
    const hiddenForMove = moveTargetTrackId(preview) !== null && preview?.kind === 'move' && preview.clipId === clip.id;
    const label = clipLabel(timeline, clip);
    const slipping = preview?.kind === 'slip' && preview.clipId === clip.id;
    const dragKind = tool === 'slip' ? 'slip' : tool === 'slide' ? 'slide' : 'move';

    return (
      <div
        key={clip.id}
        className={[
          'desktop-timeline-clip',
          `type-${track.type}`,
          isSelected ? 'selected' : '',
          clip.locked || track.locked ? 'locked' : '',
          isPreviewTarget(preview, clip.id) ? 'previewing' : '',
          hiddenForMove ? 'lifted' : '',
        ].filter(Boolean).join(' ')}
        style={{
          left: `${secondsToPercent(rect.timeline_start, scale)}%`,
          width: `${Math.max(0.9, (Math.max(rect.duration, 0) / scale) * 100)}%`,
        }}
      >
        <button
          type="button"
          className="desktop-clip-body"
          aria-current={isSelected ? 'true' : undefined}
          aria-describedby="desktop-timeline-help"
          aria-label={t(
            `${label}, ${track.name} 트랙, ${formatTimecode(clip.timeline_start)}부터 ${formatTimecode(clipEnd(clip))}까지${editable ? '' : ', 잠김'}`,
            `${label}, track ${track.name}, ${formatTimecode(clip.timeline_start)} to ${formatTimecode(clipEnd(clip))}${editable ? '' : ', locked'}`,
            `${label}，轨道 ${track.name}，${formatTimecode(clip.timeline_start)} 至 ${formatTimecode(clipEnd(clip))}${editable ? '' : '，已锁定'}`,
            `${label}、${track.name} トラック、${formatTimecode(clip.timeline_start)} から ${formatTimecode(clipEnd(clip))}${editable ? '' : '、ロック中'}`,
          )}
          title={`${label} · ${formatTimecode(clip.timeline_start)}–${formatTimecode(clipEnd(clip))}`}
          onClick={() => selectClip(clip.id)}
          onFocus={() => selectClip(clip.id)}
          onKeyDown={(event) => onClipKeyDown(event, track, clip)}
          onPointerDown={(event) => {
            selectClip(clip.id);
            if (editable) beginDrag(event, dragKind, track, clip);
          }}
          onPointerMove={updateDrag}
          onPointerUp={(event) => void endDrag(event)}
        >
          <b>{label}</b>
          <small>
            {formatTimecode(rect.duration)}
            {slipping ? ` · ${preview.delta >= 0 ? '+' : ''}${preview.delta.toFixed(2)}s` : ''}
          </small>
          {!editable ? <span className="desktop-clip-lock" aria-hidden="true">L</span> : null}
        </button>
        {isSelected && editable && editing.available ? (
          <>
            <button
              type="button"
              className="desktop-clip-handle start"
              disabled={editing.pending}
              aria-label={t(
                `${label} 시작 지점 조절`,
                `Trim the start of ${label}`,
                `调整 ${label} 的起点`,
                `${label} の開始位置を調整`,
              )}
              onPointerDown={(event) => beginDrag(event, 'trim-start', track, clip)}
              onPointerMove={updateDrag}
              onPointerUp={(event) => void endDrag(event)}
              onKeyDown={(event) => onHandleKeyDown(event, track, clip, 'start')}
            >
              <span aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`desktop-clip-handle end${tool === 'ripple' ? ' ripple' : ''}`}
              disabled={editing.pending}
              aria-label={
                tool === 'ripple'
                  ? t(
                      `${label} 끝 지점 리플 조절, 뒤 클립도 함께 이동`,
                      `Ripple trim the end of ${label}, later clips follow`,
                      `波纹调整 ${label} 的终点，后续片段一起移动`,
                      `${label} の終了位置をリップル調整、後続クリップも移動`,
                    )
                  : t(
                      `${label} 끝 지점 조절`,
                      `Trim the end of ${label}`,
                      `调整 ${label} 的终点`,
                      `${label} の終了位置を調整`,
                    )
              }
              onPointerDown={(event) => beginDrag(event, 'trim-end', track, clip)}
              onPointerMove={updateDrag}
              onPointerUp={(event) => void endDrag(event)}
              onKeyDown={(event) => onHandleKeyDown(event, track, clip, 'end')}
            >
              <span aria-hidden="true" />
            </button>
          </>
        ) : null}
      </div>
    );
  };

  const renderSeam = (track: TimelineTrack, left: TimelineClip, right: TimelineClip) => {
    const rect = previewRect(preview, track, left);
    const at = rect.timeline_start + rect.duration;
    return (
      <button
        key={`seam-${left.id}-${right.id}`}
        type="button"
        className="desktop-clip-seam"
        disabled={locked}
        style={{ left: `${secondsToPercent(at, scale)}%` }}
        aria-label={t(
          `${formatTimecode(at)} 편집점 롤 편집: ${clipLabel(timeline, left)} 다음 ${clipLabel(timeline, right)}`,
          `Roll the edit point at ${formatTimecode(at)} between ${clipLabel(timeline, left)} and ${clipLabel(timeline, right)}`,
          `滚动 ${formatTimecode(at)} 处的编辑点：${clipLabel(timeline, left)} 与 ${clipLabel(timeline, right)}`,
          `${formatTimecode(at)} の編集点をロール: ${clipLabel(timeline, left)} と ${clipLabel(timeline, right)}`,
        )}
        onPointerDown={(event) => beginDrag(event, 'roll', track, left, right.id)}
        onPointerMove={updateDrag}
        onPointerUp={(event) => void endDrag(event)}
        onKeyDown={(event) => {
          if (locked || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
          event.preventDefault();
          const step = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP);
          void run(buildRollOperation(timeline, track, left, right, clampRollBoundary(left, right, clipEnd(left) + step)));
        }}
      >
        <span aria-hidden="true" />
      </button>
    );
  };

  const seamsFor = (track: TimelineTrack) => {
    if (!selected || selected.track.id !== track.id) return [];
    const { previous, next } = adjacentNeighbours(track, selected.clip);
    const pairs: Array<[TimelineClip, TimelineClip]> = [];
    if (previous) pairs.push([previous, selected.clip]);
    if (next) pairs.push([selected.clip, next]);
    return pairs;
  };

  return (
    <section className="desktop-timeline" aria-busy={editing.pending}>
      <div className="desktop-timeline-tools">
        <div>
          <b>{t('타임라인 편집', 'Timeline editing', '时间线编辑', 'タイムライン編集')}</b>
          <span>{formatTimecode(timelineDuration(timeline))}</span>
          <span className="desktop-timeline-revision">v{timeline.revision}</span>
        </div>
        <div role="group" aria-label={t('편집 도구', 'Edit tool', '编辑工具', '編集ツール')} className="desktop-tool-group">
          {toolOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={tool === option.id}
              className={tool === option.id ? 'active' : ''}
              title={option.hint}
              onClick={() => setTool(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div>
          <button type="button" disabled={trackBusy} onClick={() => onAddTrack('video')} title={t('영상 트랙 추가', 'Add video track', '添加视频轨道', '映像トラックを追加')}>＋ V</button>
          <button type="button" disabled={trackBusy} onClick={() => onAddTrack('audio')} title={t('오디오 트랙 추가', 'Add audio track', '添加音频轨道', '音声トラックを追加')}>＋ A</button>
          <button type="button" disabled={trackBusy} onClick={() => onAddTrack('caption')} title={t('자막 트랙 추가', 'Add caption track', '添加字幕轨道', '字幕トラックを追加')}>＋ T</button>
        </div>
      </div>

      <TimelineFeedback
        feedback={editing.feedback}
        available={editing.available}
        onRetry={editing.retryLast}
        onDismiss={editing.dismissFeedback}
      />

      <div className="desktop-timeline-body">
        <div className="desktop-timeline-lanes">
          <div className="desktop-ruler-row">
            <div className="desktop-ruler-spacer">
              <span>{t('재생 위치', 'Playhead', '播放位置', '再生位置')}</span>
              <b>{formatTimecode(playhead)}</b>
            </div>
            <div className="desktop-ruler">
              {[0, 0.25, 0.5, 0.75].map((fraction) => (
                <span key={fraction}>{formatTimecode(scale * fraction)}</span>
              ))}
              <input
                type="range"
                className="desktop-playhead-input"
                min={0}
                max={roundTime(scale)}
                step={0.1}
                value={Math.min(playhead, roundTime(scale))}
                onChange={(event) => setPlayhead(Number(event.target.value))}
                aria-label={t('재생 위치', 'Playhead position', '播放位置', '再生位置')}
                aria-valuetext={formatTimecode(playhead)}
              />
            </div>
          </div>

          <div className="desktop-track-scroll">
            {tracks.length === 0 ? (
              <p className="desktop-timeline-empty">
                {t('아직 트랙이 없습니다. 위의 ＋ 버튼으로 트랙을 추가하세요.', 'No tracks yet. Use the ＋ buttons above to add one.', '尚无轨道，请用上方的 ＋ 按钮添加。', 'トラックがまだありません。上の ＋ ボタンで追加してください。')}
              </p>
            ) : null}
            {tracks.map((track) => (
              <div className="desktop-track" key={track.id}>
                <div className="desktop-track-head">
                  <b title={track.name}>
                    {track.type === 'video' ? 'V' : track.type === 'audio' ? 'A' : track.type === 'caption' ? 'T' : '◆'} {track.name}
                  </b>
                  <button
                    type="button"
                    className={track.muted ? 'active' : ''}
                    aria-pressed={track.muted}
                    disabled={trackBusy}
                    aria-label={t(`${track.name} 음소거`, `Mute ${track.name}`, `静音 ${track.name}`, `${track.name} をミュート`)}
                    onClick={() => onToggleTrack(track, 'muted')}
                  >
                    M
                  </button>
                  <button
                    type="button"
                    className={track.locked ? 'active' : ''}
                    aria-pressed={track.locked}
                    disabled={trackBusy}
                    aria-label={t(`${track.name} 잠금`, `Lock ${track.name}`, `锁定 ${track.name}`, `${track.name} をロック`)}
                    onClick={() => onToggleTrack(track, 'locked')}
                  >
                    L
                  </button>
                </div>
                <div
                  className={[
                    'desktop-track-lane',
                    track.muted ? 'muted' : '',
                    track.locked ? 'locked' : '',
                    moveTargetTrackId(preview) === track.id ? 'drop-target' : '',
                  ].filter(Boolean).join(' ')}
                  ref={(element) => {
                    if (element) laneRefs.current.set(track.id, element);
                    else laneRefs.current.delete(track.id);
                  }}
                >
                  {track.clips.length === 0 ? (
                    <span className="desktop-lane-empty">
                      {t('빈 트랙', 'Empty track', '空轨道', '空のトラック')}
                    </span>
                  ) : null}
                  {track.clips.map((clip) => renderClip(track, clip))}
                  {seamsFor(track).map(([left, right]) => renderSeam(track, left, right))}
                  {moveTargetTrackId(preview) === track.id && preview?.kind === 'move' ? (
                    <span
                      className="desktop-clip-ghost"
                      aria-hidden="true"
                      style={{
                        left: `${secondsToPercent(preview.timelineStart, scale)}%`,
                        width: `${Math.max(0.9, ((findClip(timeline, preview.clipId)?.clip.duration ?? 0) / scale) * 100)}%`,
                      }}
                    />
                  ) : null}
                  <span
                    className="desktop-playhead-line"
                    aria-hidden="true"
                    style={{ left: `${secondsToPercent(playhead, scale)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p id="desktop-timeline-help" className="desktop-timeline-help">
            {activeHint}{' '}
            {t(
              '키보드: ← → 이동, ↑ ↓ 트랙 이동, [ 와 ] 재생 위치로 자르기, Shift + ] 리플, S 분할. 자르기는 길이를 줄이기만 하며, 늘리려면 롤 편집이나 오른쪽 클립 속성의 길이를 쓰세요.',
              'Keyboard: ← → move, ↑ ↓ change track, [ and ] trim to the playhead, Shift + ] ripple, S split. Trimming only shortens a clip — to lengthen one use a roll edit or the duration field in the clip inspector.',
              '键盘：← → 移动，↑ ↓ 换轨道，[ 和 ] 裁剪到播放位置，Shift + ] 波纹，S 分割。裁剪只能缩短片段，若要加长请使用滚动编辑或右侧片段属性中的时长。',
              'キーボード: ← → 移動、↑ ↓ トラック変更、[ と ] 再生位置でトリム、Shift + ] リップル、S 分割。トリムは短くするだけです。長くするにはロール編集かクリップ属性の長さを使ってください。',
            )}
          </p>
        </div>

        <TimelinePrecisionPanel
          timeline={timeline}
          selected={selected}
          playhead={playhead}
          onPlayheadChange={setPlayhead}
          tracks={tracks}
          editing={editing}
          disabled={locked}
          onRun={run}
        />
      </div>
    </section>
  );
}
