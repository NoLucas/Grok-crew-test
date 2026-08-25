'use client';

// P1-01 direct-edit timeline UI: clip drag/move, left/right trim handles,
// split at playhead, ripple/roll/slip/slide, snapping, selection, keyboard
// shortcuts, and loading/error/locked/stale-conflict states.
//
// Scope boundary (see docs/AI_COLLABORATION.ko.md): this component only
// calls the already-frozen grok-crew.timeline-patch/v1 contract through
// applyTimelinePatch() in ./timelineApi.ts. It never invents a parallel
// contract (no localStorage-backed edits, no speculative fields).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_PX_PER_SECOND,
  MAX_PX_PER_SECOND,
  MIN_PX_PER_SECOND,
  buildPatchBody,
  clampInsideClip,
  clampRollBoundary,
  clampSlideStart,
  clipEnd,
  collectSnapPoints,
  frameSeconds,
  hasSourceWindow,
  isClipLocked,
  moveClipOp,
  pxToTime,
  removeClipOp,
  rippleTrimOp,
  rollEditOp,
  round3,
  slideClipOp,
  slipClipOp,
  snapTime,
  splitClipOp,
  timeToPx,
  trimClipOp,
  updateClipOp,
} from './timelineMath';
import { applyTimelinePatch } from './timelineApi';
import { classifyPatchError, TimelinePatchClientError, type Clip, type Timeline, type Track, type TrackType } from './timelineTypes';

type Tool = 'select' | 'ripple' | 'roll' | 'slip' | 'slide';

const TOOL_ORDER: Tool[] = ['select', 'ripple', 'roll', 'slip', 'slide'];
const TOOL_LABEL: Record<Tool, string> = {
  select: 'Select / Move',
  ripple: 'Ripple trim',
  roll: 'Roll edit',
  slip: 'Slip',
  slide: 'Slide',
};
const TOOL_HINT: Record<Tool, string> = {
  select: '클립을 드래그해 이동하고, 좌우 가장자리를 드래그해 다듬습니다.',
  ripple: '오른쪽 가장자리를 드래그하면 뒤 클립들이 함께 밀립니다.',
  roll: '맞닿은 두 클립 사이의 경계를 드래그합니다.',
  slip: '클립 길이는 그대로 두고 원본 구간만 이동합니다.',
  slide: '클립을 이동하며 양옆 클립 길이를 자동으로 조절합니다.',
};

type MoveDrag = { kind: 'move'; clipId: string; trackId: string; startClientX: number; originalStart: number; previewStart: number; previewTrackId: string };
type TrimDrag = { kind: 'trim'; clipId: string; trackId: string; edge: 'start' | 'end'; startClientX: number; originalAt: number; previewAt: number };
type RippleDrag = { kind: 'ripple'; clipId: string; trackId: string; startClientX: number; originalAt: number; previewAt: number; followerIds: string[] };
type RollDrag = { kind: 'roll'; leftClipId: string; rightClipId: string; trackId: string; startClientX: number; originalAt: number; previewAt: number };
type SlipDrag = { kind: 'slip'; clipId: string; trackId: string; startClientX: number; originalSourceIn: number; previewSourceIn: number };
type SlideDrag = { kind: 'slide'; previousClipId: string; clipId: string; nextClipId: string; trackId: string; startClientX: number; originalStart: number; previewStart: number };
type DragSession = MoveDrag | TrimDrag | RippleDrag | RollDrag | SlipDrag | SlideDrag;

export type TimelineEditorProps = {
  projectId: string | null;
  timeline: Timeline | null;
  loading: boolean;
  loadError: string | null;
  selectedClipId: string;
  onSelectClip: (clipId: string) => void;
  onAddTrack: (type: TrackType) => void;
  onToggleTrack: (track: Track, field: 'locked' | 'muted') => void;
  onPatched: (timeline: Timeline) => void;
  onReload: () => void;
};

function trackGlyph(type: TrackType): string {
  return type === 'video' ? 'V' : type === 'audio' ? 'A' : type === 'caption' ? 'T' : '◆';
}

function formatTime(value: number): string {
  const safe = Math.max(0, value);
  const minutes = Math.floor(safe / 60);
  const seconds = safe - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}`;
}

function formatDelta(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}s`;
}

export default function TimelineEditor({ projectId, timeline, loading, loadError, selectedClipId, onSelectClip, onAddTrack, onToggleTrack, onPatched, onReload }: TimelineEditorProps) {
  const [tool, setTool] = useState<Tool>('select');
  const [pxPerSecond, setPxPerSecond] = useState(DEFAULT_PX_PER_SECOND);
  const [playhead, setPlayhead] = useState(0);
  const [drag, setDrag] = useState<DragSession | null>(null);
  const [snapGuide, setSnapGuide] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [staleConflict, setStaleConflict] = useState<{ expected: number; received: number } | null>(null);
  const [lastSavedRevision, setLastSavedRevision] = useState<number | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const laneRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragSession | null>(null);
  // Event handlers attached below only re-attach when drag transitions
  // to/from null (see the `drag !== null` effect dependency), so they read
  // the latest in-progress preview through this ref instead of a stale
  // closure. Mutated in an effect, never during render (react-hooks/refs).
  useEffect(() => { dragRef.current = drag; }, [drag]);

  const fps = typeof timeline?.settings.fps === 'number' ? timeline.settings.fps : 30;
  const step = frameSeconds(fps);

  const duration = (() => {
    let max = 10;
    for (const track of timeline?.tracks ?? []) for (const clip of track.clips) max = Math.max(max, clipEnd(clip));
    return max;
  })();

  const selected = (() => {
    if (!timeline || !selectedClipId) return null;
    for (const track of timeline.tracks) {
      const clip = track.clips.find((item) => item.id === selectedClipId);
      if (clip) return { track, clip };
    }
    return null;
  })();

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const commit = useCallback(
    async (operation: ReturnType<typeof moveClipOp>, successMessage: string) => {
      if (!projectId || !timeline || staleConflict) return;
      setBusy(true);
      try {
        const body = buildPatchBody(timeline.revision, [operation], 'operator');
        const next = await applyTimelinePatch(projectId, body);
        setLastSavedRevision(next.revision);
        onPatched(next);
        setToast(`${successMessage} · v${next.revision}로 저장됨, 버전 기록에서 되돌릴 수 있습니다.`);
      } catch (error) {
        const { kind } = classifyPatchError(error);
        if (kind === 'stale' && error instanceof TimelinePatchClientError) {
          const expected = Number(error.details.expected_revision ?? timeline.revision);
          const received = Number(error.details.received_revision ?? timeline.revision);
          setStaleConflict({ expected, received });
        } else if (kind === 'locked') {
          setToast('이 클립 또는 트랙은 잠겨 있어 수정할 수 없습니다.');
        } else if (error instanceof TimelinePatchClientError) {
          setToast(error.message);
        } else {
          setToast(error instanceof Error ? error.message : '편집을 저장하지 못했습니다.');
        }
      } finally {
        setBusy(false);
      }
    },
    [projectId, timeline, staleConflict, onPatched],
  );

  // ---- pointer-drag session -------------------------------------------------

  const xToTimeDelta = useCallback((clientX: number, startClientX: number) => pxToTime(clientX - startClientX, pxPerSecond), [pxPerSecond]);

  const beginDrag = useCallback((session: DragSession) => {
    if (staleConflict || busy) return;
    setDrag(session);
  }, [staleConflict, busy]);

  useEffect(() => {
    if (!drag || !timeline) return;

    const handleMove = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      const deltaTime = xToTimeDelta(event.clientX, current.startClientX);

      if (current.kind === 'move') {
        const track = timeline.tracks.find((item) => item.id === current.trackId);
        const clip = track?.clips.find((item) => item.id === current.clipId);
        if (!track || !clip) return;
        const raw = Math.max(0, current.originalStart + deltaTime);
        const candidates = collectSnapPoints(timeline, { excludeClipIds: new Set([clip.id]), playhead });
        const snapped = snapTime(raw, candidates, pxPerSecond);
        let targetTrackId = current.previewTrackId;
        for (const [id, node] of laneRefs.current) {
          const rect = node.getBoundingClientRect();
          if (event.clientY >= rect.top && event.clientY <= rect.bottom) { targetTrackId = id; break; }
        }
        setDrag({ ...current, previewStart: Math.max(0, snapped.value), previewTrackId: targetTrackId });
        setSnapGuide(snapped.snapped ? snapped.snapPoint ?? null : null);
        return;
      }

      if (current.kind === 'trim') {
        const track = timeline.tracks.find((item) => item.id === current.trackId);
        const clip = track?.clips.find((item) => item.id === current.clipId);
        if (!clip) return;
        const raw = current.originalAt + deltaTime;
        const candidates = collectSnapPoints(timeline, { excludeClipIds: new Set([clip.id]), playhead });
        const snapped = snapTime(raw, candidates, pxPerSecond);
        setDrag({ ...current, previewAt: clampInsideClip(clip, snapped.value) });
        setSnapGuide(snapped.snapped ? snapped.snapPoint ?? null : null);
        return;
      }

      if (current.kind === 'ripple') {
        const track = timeline.tracks.find((item) => item.id === current.trackId);
        const clip = track?.clips.find((item) => item.id === current.clipId);
        if (!clip) return;
        const raw = current.originalAt + deltaTime;
        const excluded = new Set([clip.id, ...current.followerIds]);
        const candidates = collectSnapPoints(timeline, { excludeClipIds: excluded, playhead });
        const snapped = snapTime(raw, candidates, pxPerSecond);
        setDrag({ ...current, previewAt: clampInsideClip(clip, snapped.value) });
        setSnapGuide(snapped.snapped ? snapped.snapPoint ?? null : null);
        return;
      }

      if (current.kind === 'roll') {
        const track = timeline.tracks.find((item) => item.id === current.trackId);
        const left = track?.clips.find((item) => item.id === current.leftClipId);
        const right = track?.clips.find((item) => item.id === current.rightClipId);
        if (!left || !right) return;
        const raw = current.originalAt + deltaTime;
        const candidates = collectSnapPoints(timeline, { excludeClipIds: new Set([left.id, right.id]), playhead });
        const snapped = snapTime(raw, candidates, pxPerSecond);
        setDrag({ ...current, previewAt: clampRollBoundary(left, right, snapped.value) });
        setSnapGuide(snapped.snapped ? snapped.snapPoint ?? null : null);
        return;
      }

      if (current.kind === 'slip') {
        const raw = Math.max(0, current.originalSourceIn + deltaTime);
        setDrag({ ...current, previewSourceIn: round3(raw) });
        setSnapGuide(null);
        return;
      }

      if (current.kind === 'slide') {
        const track = timeline.tracks.find((item) => item.id === current.trackId);
        const previous = track?.clips.find((item) => item.id === current.previousClipId);
        const selectedClip = track?.clips.find((item) => item.id === current.clipId);
        const following = track?.clips.find((item) => item.id === current.nextClipId);
        if (!previous || !selectedClip || !following) return;
        const raw = current.originalStart + deltaTime;
        const excluded = new Set([previous.id, selectedClip.id, following.id]);
        const candidates = collectSnapPoints(timeline, { excludeClipIds: excluded, playhead });
        const snapped = snapTime(raw, candidates, pxPerSecond);
        setDrag({ ...current, previewStart: clampSlideStart(previous, selectedClip, following, snapped.value) });
        setSnapGuide(snapped.snapped ? snapped.snapPoint ?? null : null);
        return;
      }
    };

    const handleUp = () => {
      const current = dragRef.current;
      setDrag(null);
      setSnapGuide(null);
      if (!current) return;

      if (current.kind === 'move') {
        if (Math.abs(current.previewStart - current.originalStart) > 0.0005 || current.previewTrackId !== current.trackId) {
          void commit(moveClipOp(current.clipId, current.previewStart, current.previewTrackId !== current.trackId ? current.previewTrackId : undefined), '이동');
        }
      } else if (current.kind === 'trim') {
        if (Math.abs(current.previewAt - current.originalAt) > 0.0005) void commit(trimClipOp(current.clipId, current.edge, current.previewAt), '다듬기');
      } else if (current.kind === 'ripple') {
        if (Math.abs(current.previewAt - current.originalAt) > 0.0005) void commit(rippleTrimOp(current.clipId, current.previewAt), '리플 다듬기');
      } else if (current.kind === 'roll') {
        if (Math.abs(current.previewAt - current.originalAt) > 0.0005) void commit(rollEditOp(current.leftClipId, current.rightClipId, current.previewAt), '롤 편집');
      } else if (current.kind === 'slip') {
        if (Math.abs(current.previewSourceIn - current.originalSourceIn) > 0.0005) void commit(slipClipOp(current.clipId, current.previewSourceIn), '슬립');
      } else if (current.kind === 'slide') {
        if (Math.abs(current.previewStart - current.originalStart) > 0.0005) void commit(slideClipOp(current.previousClipId, current.clipId, current.nextClipId, current.previewStart), '슬라이드');
      }
    };

    const handleCancel = () => { setDrag(null); setSnapGuide(null); };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleCancel);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null, timeline, pxPerSecond, playhead, commit, xToTimeDelta]);

  // ---- display geometry (applies the live drag preview, if any) -------------

  const displayFor = useCallback(
    (track: Track, clip: Clip): { start: number; duration: number; sourceInDelta: number } => {
      if (!drag) return { start: clip.timeline_start, duration: clip.duration, sourceInDelta: 0 };
      if (drag.kind === 'move' && drag.clipId === clip.id) return { start: drag.previewStart, duration: clip.duration, sourceInDelta: 0 };
      if (drag.kind === 'trim' && drag.clipId === clip.id) {
        if (drag.edge === 'start') return { start: drag.previewAt, duration: clipEnd(clip) - drag.previewAt, sourceInDelta: 0 };
        return { start: clip.timeline_start, duration: drag.previewAt - clip.timeline_start, sourceInDelta: 0 };
      }
      if (drag.kind === 'ripple') {
        if (drag.clipId === clip.id) return { start: clip.timeline_start, duration: drag.previewAt - clip.timeline_start, sourceInDelta: 0 };
        if (drag.trackId === track.id && drag.followerIds.includes(clip.id)) {
          const shift = drag.previewAt - drag.originalAt;
          return { start: clip.timeline_start + shift, duration: clip.duration, sourceInDelta: 0 };
        }
      }
      if (drag.kind === 'roll') {
        if (drag.leftClipId === clip.id) return { start: clip.timeline_start, duration: drag.previewAt - clip.timeline_start, sourceInDelta: 0 };
        if (drag.rightClipId === clip.id) return { start: drag.previewAt, duration: clipEnd(clip) - drag.previewAt, sourceInDelta: 0 };
      }
      if (drag.kind === 'slip' && drag.clipId === clip.id) return { start: clip.timeline_start, duration: clip.duration, sourceInDelta: drag.previewSourceIn - drag.originalSourceIn };
      if (drag.kind === 'slide') {
        if (drag.previousClipId === clip.id) return { start: clip.timeline_start, duration: clip.duration + (drag.previewStart - drag.originalStart), sourceInDelta: 0 };
        if (drag.clipId === clip.id) return { start: drag.previewStart, duration: clip.duration, sourceInDelta: 0 };
        if (drag.nextClipId === clip.id) {
          const shift = drag.previewStart - drag.originalStart;
          return { start: clip.timeline_start + shift, duration: clip.duration - shift, sourceInDelta: 0 };
        }
      }
      return { start: clip.timeline_start, duration: clip.duration, sourceInDelta: 0 };
    },
    [drag],
  );

  // ---- clip interaction handlers --------------------------------------------

  const handleClipPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, track: Track, clip: Clip) => {
      onSelectClip(clip.id);
      if (staleConflict || isClipLocked(track, clip)) return;
      const startClientX = event.clientX;

      if (tool === 'slip') {
        if (!hasSourceWindow(clip)) { setToast('이 클립은 원본 소스 구간 정보가 없어 슬립할 수 없습니다.'); return; }
        beginDrag({ kind: 'slip', clipId: clip.id, trackId: track.id, startClientX, originalSourceIn: clip.source_in ?? 0, previewSourceIn: clip.source_in ?? 0 });
        return;
      }
      if (tool === 'slide') {
        const sorted = [...track.clips].sort((a, b) => a.timeline_start - b.timeline_start);
        const index = sorted.findIndex((item) => item.id === clip.id);
        const previous = sorted[index - 1];
        const following = sorted[index + 1];
        const touchesPrev = previous && Math.abs(clipEnd(previous) - clip.timeline_start) <= 0.001;
        const touchesNext = following && Math.abs(clipEnd(clip) - following.timeline_start) <= 0.001;
        if (!previous || !following || !touchesPrev || !touchesNext) { setToast('슬라이드는 양옆에 맞닿은 클립이 있어야 합니다.'); return; }
        if (isClipLocked(track, previous) || isClipLocked(track, following)) { setToast('양옆 클립이 잠겨 있어 슬라이드할 수 없습니다.'); return; }
        beginDrag({ kind: 'slide', previousClipId: previous.id, clipId: clip.id, nextClipId: following.id, trackId: track.id, startClientX, originalStart: clip.timeline_start, previewStart: clip.timeline_start });
        return;
      }
      // 'select' and 'ripple' both allow moving the clip body.
      beginDrag({ kind: 'move', clipId: clip.id, trackId: track.id, startClientX, originalStart: clip.timeline_start, previewStart: clip.timeline_start, previewTrackId: track.id });
    },
    [tool, staleConflict, beginDrag, onSelectClip],
  );

  const handleTrimPointerDown = useCallback(
    (event: React.PointerEvent<HTMLSpanElement>, track: Track, clip: Clip, edge: 'start' | 'end') => {
      event.stopPropagation();
      onSelectClip(clip.id);
      if (staleConflict || isClipLocked(track, clip)) return;
      const startClientX = event.clientX;
      if (tool === 'ripple') {
        if (edge !== 'end') { setToast('리플 다듬기는 오른쪽 가장자리에서만 지원됩니다.'); return; }
        const oldEnd = clipEnd(clip);
        const followers = track.clips.filter((item) => item.id !== clip.id && item.timeline_start >= oldEnd - 0.001);
        const lockedFollower = followers.find((item) => isClipLocked(track, item));
        if (lockedFollower) { setToast('뒤 클립이 잠겨 있어 리플 다듬기를 할 수 없습니다.'); return; }
        beginDrag({ kind: 'ripple', clipId: clip.id, trackId: track.id, startClientX, originalAt: oldEnd, previewAt: oldEnd, followerIds: followers.map((item) => item.id) });
        return;
      }
      if (tool !== 'select') return;
      const originalAt = edge === 'start' ? clip.timeline_start : clipEnd(clip);
      beginDrag({ kind: 'trim', clipId: clip.id, trackId: track.id, edge, startClientX, originalAt, previewAt: originalAt });
    },
    [tool, staleConflict, beginDrag, onSelectClip],
  );

  const handleRollPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, track: Track, left: Clip, right: Clip) => {
      event.stopPropagation();
      if (staleConflict || isClipLocked(track, left) || isClipLocked(track, right)) return;
      const at = clipEnd(left);
      beginDrag({ kind: 'roll', leftClipId: left.id, rightClipId: right.id, trackId: track.id, startClientX: event.clientX, originalAt: at, previewAt: at });
    },
    [staleConflict, beginDrag],
  );

  // ---- toolbar actions --------------------------------------------------

  const splitAtPlayhead = useCallback(() => {
    if (!selected) { setToast('먼저 클립을 선택하세요.'); return; }
    const { clip } = selected;
    if (playhead <= clip.timeline_start + 0.001 || playhead >= clipEnd(clip) - 0.001) { setToast('재생 헤드가 선택한 클립 안에 있어야 분할할 수 있습니다.'); return; }
    if (isClipLocked(selected.track, clip)) { setToast('잠긴 클립은 분할할 수 없습니다.'); return; }
    void commit(splitClipOp(clip.id, playhead, `${clip.id}-a`, `${clip.id}-b`), '분할');
  }, [selected, playhead, commit]);

  const removeSelected = useCallback(() => {
    if (!selected) return;
    if (isClipLocked(selected.track, selected.clip)) { setToast('잠긴 클립은 삭제할 수 없습니다.'); return; }
    void commit(removeClipOp(selected.clip.id), '삭제');
  }, [selected, commit]);

  const toggleSelectedLock = useCallback(() => {
    if (!selected) return;
    void commit(updateClipOp(selected.clip.id, { locked: !selected.clip.locked }), selected.clip.locked ? '잠금 해제' : '잠금');
  }, [selected, commit]);

  const nudgeSelected = useCallback((deltaSeconds: number) => {
    if (!selected) return;
    if (isClipLocked(selected.track, selected.clip)) { setToast('잠긴 클립은 이동할 수 없습니다.'); return; }
    void commit(moveClipOp(selected.clip.id, Math.max(0, round3(selected.clip.timeline_start + deltaSeconds))), '이동');
  }, [selected, commit]);

  const trimSelectedEdge = useCallback((edge: 'start' | 'end', deltaSeconds: number) => {
    if (!selected) return;
    if (isClipLocked(selected.track, selected.clip)) { setToast('잠긴 클립은 다듬을 수 없습니다.'); return; }
    const at = edge === 'start' ? selected.clip.timeline_start + deltaSeconds : clipEnd(selected.clip) + deltaSeconds;
    void commit(trimClipOp(selected.clip.id, edge, clampInsideClip(selected.clip, at)), '다듬기');
  }, [selected, commit]);

  const fitZoom = useCallback(() => {
    const width = scrollRef.current?.clientWidth ?? 800;
    const next = Math.min(MAX_PX_PER_SECOND, Math.max(MIN_PX_PER_SECOND, Math.floor((width - 24) / Math.max(1, duration))));
    setPxPerSecond(next);
  }, [duration]);

  // ---- keyboard shortcuts -------------------------------------------------

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (drag) { if (event.key === 'Escape') setDrag(null); return; }

      if (event.key >= '1' && event.key <= '5') { setTool(TOOL_ORDER[Number(event.key) - 1]); return; }
      if (event.key === '+' || event.key === '=') { event.preventDefault(); setPxPerSecond((value) => Math.min(MAX_PX_PER_SECOND, Math.round(value * 1.25))); return; }
      if (event.key === '-' || event.key === '_') { event.preventDefault(); setPxPerSecond((value) => Math.max(MIN_PX_PER_SECOND, Math.round(value / 1.25))); return; }
      if (event.key === 'Home') { setPlayhead(0); return; }
      if (event.key === 'End') { setPlayhead(duration); return; }
      if (event.key === 'Escape') { onSelectClip(''); return; }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const magnitude = event.shiftKey ? 1 : step;
        const delta = event.key === 'ArrowLeft' ? -magnitude : magnitude;
        if (selected && tool === 'select') { nudgeSelected(delta); return; }
        setPlayhead((value) => Math.max(0, Math.min(duration, round3(value + delta))));
        return;
      }
      if (event.key === '[' || event.key === ']') {
        event.preventDefault();
        const magnitude = event.shiftKey ? 1 : step;
        trimSelectedEdge(event.key === '[' ? 'start' : 'end', event.key === '[' ? -magnitude : magnitude);
        return;
      }
      if (event.key === 's' || event.key === 'S') { splitAtPlayhead(); return; }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelected(); return; }
      if (event.key === 'l' || event.key === 'L') { toggleSelectedLock(); return; }
    },
    [drag, selected, tool, step, duration, nudgeSelected, trimSelectedEdge, splitAtPlayhead, removeSelected, toggleSelectedLock, onSelectClip],
  );

  const seekFromRulerClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!scrollRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const time = pxToTime(event.clientX - rect.left + scrollRef.current.scrollLeft, pxPerSecond);
    setPlayhead(Math.max(0, Math.min(duration, round3(time))));
  }, [pxPerSecond, duration]);

  const contentWidth = Math.max(1, Math.round(timeToPx(duration, pxPerSecond)));
  const rulerTicks = useMemo(() => {
    const tickCount = 10;
    return Array.from({ length: tickCount + 1 }, (_, index) => (duration / tickCount) * index);
  }, [duration]);

  // ---- render -------------------------------------------------------------

  if (loading && !timeline) {
    return (
      <section className="desktop-timeline">
        <div className="timeline-state timeline-loading" role="status" aria-live="polite">
          <span className="timeline-spinner" aria-hidden="true" />
          <p>타임라인을 불러오는 중입니다…</p>
        </div>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="desktop-timeline">
        <div className="timeline-state timeline-error" role="alert">
          <p>{loadError}</p>
          <button onClick={onReload}>다시 시도</button>
        </div>
      </section>
    );
  }

  if (!timeline) return null;

  return (
    <section className="desktop-timeline" ref={containerRef} tabIndex={0} onKeyDown={handleKeyDown} aria-label="타임라인 편집기">
      {staleConflict && (
        <div className="timeline-stale-banner" role="alert">
          <span>
            다른 곳에서 타임라인이 변경되었습니다 (현재 v{staleConflict.expected}, 시도한 버전 v{staleConflict.received}). 최신 버전을 불러와야 계속 편집할 수 있습니다.
          </span>
          <button onClick={() => { setStaleConflict(null); onReload(); }}>최신 버전 불러오기</button>
        </div>
      )}

      <div className="desktop-timeline-tools">
        <div>
          <b>타임라인</b>
          <span>{formatTime(playhead)} / {formatTime(duration)}</span>
          {lastSavedRevision !== null && <span className="timeline-saved-chip">v{lastSavedRevision} 저장됨</span>}
        </div>
        <div className="timeline-tool-group" role="group" aria-label="편집 도구">
          {TOOL_ORDER.map((item, index) => (
            <button key={item} className={tool === item ? 'active' : ''} title={`${TOOL_LABEL[item]} (${index + 1})`} aria-pressed={tool === item} onClick={() => setTool(item)}>
              {TOOL_LABEL[item]}
            </button>
          ))}
        </div>
        <div>
          <button onClick={() => onAddTrack('video')}>＋ V</button>
          <button onClick={() => onAddTrack('audio')}>＋ A</button>
          <button onClick={() => onAddTrack('caption')}>＋ T</button>
          <button disabled={!selected} onClick={splitAtPlayhead}>⌁ 분할 (S)</button>
          <button onClick={() => setPxPerSecond((value) => Math.max(MIN_PX_PER_SECOND, Math.round(value / 1.25)))} title="축소 (-)">－</button>
          <button onClick={fitZoom} title="화면에 맞추기">맞춤</button>
          <button onClick={() => setPxPerSecond((value) => Math.min(MAX_PX_PER_SECOND, Math.round(value * 1.25)))} title="확대 (+)">＋</button>
        </div>
      </div>
      <p className="timeline-tool-hint">{TOOL_HINT[tool]}</p>
      {busy && <div className="timeline-busy-chip" role="status" aria-live="polite">저장 중…</div>}

      <div className="desktop-track-scroll" ref={scrollRef}>
        <div className="timeline-ruler-row" onMouseDown={seekFromRulerClick}>
          <div className="timeline-track-head-spacer" />
          <div className="timeline-ruler" style={{ width: contentWidth, gridTemplateColumns: `repeat(${rulerTicks.length}, 1fr)` }}>
            {rulerTicks.map((tick) => <span key={tick}>{formatTime(tick)}</span>)}
            <div className="timeline-playhead timeline-playhead-flag" style={{ left: timeToPx(playhead, pxPerSecond) }} />
          </div>
        </div>

        {timeline.tracks.length === 0 && (
          <div className="timeline-state timeline-empty-tracks">
            <p>아직 트랙이 없습니다. 위의 ＋ 버튼으로 비디오, 오디오, 자막 트랙을 추가하세요.</p>
          </div>
        )}

        {[...timeline.tracks].sort((a, b) => a.order - b.order).map((track) => {
          const sortedClips = [...track.clips].sort((a, b) => a.timeline_start - b.timeline_start);
          return (
            <div className="desktop-track timeline-track" key={track.id}>
              <div className="desktop-track-head">
                <b title={track.name}>{trackGlyph(track.type)} {track.name}</b>
                <button className={track.muted ? 'active' : ''} title="음소거" onClick={() => onToggleTrack(track, 'muted')}>M</button>
                <button className={track.locked ? 'active' : ''} title="트랙 잠금" onClick={() => onToggleTrack(track, 'locked')}>⌑</button>
              </div>
              <div
                className={`desktop-track-lane timeline-lane ${track.muted ? 'muted' : ''} ${drag?.kind === 'move' && drag.previewTrackId === track.id ? 'drop-target' : ''}`}
                style={{ width: contentWidth }}
                ref={(node) => { if (node) laneRefs.current.set(track.id, node); else laneRefs.current.delete(track.id); }}
              >
                <div className="timeline-playhead" style={{ left: timeToPx(playhead, pxPerSecond) }} />
                {snapGuide !== null && <div className="timeline-snap-guide" style={{ left: timeToPx(snapGuide, pxPerSecond) }} />}
                {sortedClips.length === 0 && <span className="timeline-empty-lane">빈 트랙</span>}
                {sortedClips.map((clip, index) => {
                  const display = displayFor(track, clip);
                  const locked = isClipLocked(track, clip);
                  const label = clip.text || timeline.assets.find((asset) => asset.id === clip.asset_id)?.name || clip.id;
                  const nextClip = sortedClips[index + 1];
                  const touchesNext = nextClip && Math.abs(clipEnd(clip) - nextClip.timeline_start) <= 0.001;
                  return (
                    <div key={clip.id} className="timeline-clip-wrap" style={{ left: timeToPx(display.start, pxPerSecond), width: Math.max(6, timeToPx(display.duration, pxPerSecond)) }}>
                      <button
                        type="button"
                        className={`desktop-timeline-clip type-${track.type} ${clip.id === selectedClipId ? 'selected' : ''} ${locked ? 'locked' : ''}`}
                        onPointerDown={(event) => handleClipPointerDown(event, track, clip)}
                        title={`${label} · ${formatTime(display.start)}–${formatTime(display.start + display.duration)}${locked ? ' · 잠김' : ''}`}
                      >
                        {locked && <span className="timeline-clip-lock" aria-hidden="true">⌑</span>}
                        <b>{label}</b>
                        <small>{formatTime(display.duration)}</small>
                        {display.sourceInDelta !== 0 && <span className="timeline-slip-badge">{formatDelta(display.sourceInDelta)}</span>}
                      </button>
                      {!locked && tool === 'select' && (
                        <>
                          <span className="timeline-trim-handle left" onPointerDown={(event) => handleTrimPointerDown(event, track, clip, 'start')} />
                          <span className="timeline-trim-handle right" onPointerDown={(event) => handleTrimPointerDown(event, track, clip, 'end')} />
                        </>
                      )}
                      {!locked && tool === 'ripple' && <span className="timeline-trim-handle right ripple" onPointerDown={(event) => handleTrimPointerDown(event, track, clip, 'end')} />}
                      {tool === 'roll' && touchesNext && !locked && !isClipLocked(track, nextClip) && (
                        <div className="timeline-roll-handle" style={{ left: Math.max(6, timeToPx(display.duration, pxPerSecond)) - 4 }} onPointerDown={(event) => handleRollPointerDown(event, track, clip, nextClip)} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <p className="timeline-shortcuts-legend">
        1–5 도구 전환 · 드래그 이동/다듬기 · [ ] 가장자리 다듬기 · S 분할 · Del 삭제 · L 잠금 전환 · ← → 재생 헤드/클립 이동(Shift=1초) · +/− 확대·축소
      </p>
      {toast && <div className="timeline-toast" role="status" aria-live="polite">{toast}</div>}
    </section>
  );
}
