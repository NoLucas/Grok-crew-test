'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { LanguageSwitcher, useLanguage } from './language';
import { AudioMixer } from './timeline/AudioMixer';
import { ClipLookPanel } from './timeline/ClipLookPanel';
import { ProgramMonitor } from './timeline/ProgramMonitor';
import { TimelineEditor } from './timeline/TimelineEditor';
import { useTimelineEditing } from './timeline/use-timeline-editing';
import { findClip } from './timeline/geometry';
import { buildSplitOperation } from './timeline/operations';
import type { TimelinePatch } from './timeline/operations';
import { buildTimelineHistoryAction, emptyTimelineHistory } from './timeline/history';
import type { TimelineHistoryAction, TimelineHistoryResult, TimelineHistoryState } from './timeline/history';
import type { Timeline, TrackType } from './timeline/types';

type UpdateStatus = {
  status: string;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  message: string;
};

declare global {
  interface Window {
    grokCrew?: {
      apiBase: string;
      request: (path: string, request?: { method?: string; body?: string | null }) => Promise<unknown>;
      applyTimelinePatch: (projectId: string, patch: TimelinePatch) => Promise<unknown>;
      selectMedia: () => Promise<string | null>;
      showOutput: (path: string) => Promise<void>;
      appInfo: () => Promise<{ version: string; platform: string; packaged: boolean }>;
      updateStatus?: () => Promise<UpdateStatus>;
      openRelease?: (url: string) => Promise<void>;
      pairRunner: () => Promise<{ runner_id: string; display_name: string } | null>;
      exportDesktopPairing: () => Promise<{ file: string; desktop_id: string } | null>;
      exportRunnerRequest: (controlJobId: string) => Promise<{ file: string; runner_id: string } | null>;
      importRunnerResult: () => Promise<{ control_job_id: string; revision?: number; runner_id: string; needs_input?: NeedsInput } | null>;
      answerRunnerInput: (controlJobId: string, answer: { question_id: string; value: string }) => Promise<{ file?: string; branch?: string; runner_id: string } | null>;
      connectGitRelay: () => Promise<{ repo: string; remote: string } | null>;
      githubStatus: () => Promise<GitHubStatus>;
      loginGitHubDevice: () => Promise<GitHubStatus | null>;
      loginGitHubToken: (token: string) => Promise<GitHubStatus>;
      pushGitRequest: (controlJobId: string) => Promise<{ branch: string; path: string; runner_id: string }>;
      pullGitResults: () => Promise<{ count: number }>;
      controlRunnerJob: (controlJobId: string, command: 'cancel' | 'pause' | 'resume' | 'retry', reason?: string) => Promise<{ command: string }>;
      resolveRunnerConflict: (controlJobId: string, action: 'discard' | 'retry_current') => Promise<unknown>;
    };
  }
}

function studioBase() {
  return typeof window !== 'undefined' && window.grokCrew?.apiBase ? window.grokCrew.apiBase : 'http://127.0.0.1:7214';
}
type PublishMode = 'export_only' | 'ask' | 'auto';
type Project = { id: string; title: string; source_path: string; output_path: string; updated_at: string; current_revision: number };
type TimelineConflict = { schema: string; reason: string; expected_revision: number; current_revision: number; timeline_patch?: { operations?: unknown[] } };
type ControlJob = { id: string; project_id: string; status: string; execution_policy: string; updated_at: string; error_text?: string; result_revision?: number; attempt?: number; control_sequence?: number; runner_id?: string; render_job_id?: string; conflict_json?: TimelineConflict };
type RunnerEvent = { id: string; control_job_id: string; runner_id: string; sequence: number; stage: string; status: string; detail_json: Record<string, unknown>; verified_at: string };
type NeedsInput = { schema: 'grok-crew.runner-needs-input/v1'; question_id: string; question: string; options: Array<{ value: string; label: string; description?: string }> };
type Runner = { runner_id: string; display_name: string; status: string; last_seen?: string };
type MediaItem = { name: string; path: string; kind: string; size_bytes: number; area: string };
type Version = {
  id: string;
  revision: number;
  origin: string;
  created_by: string;
  created_at: string;
  action_kind?: 'edit' | 'undo' | 'redo' | 'restore';
  restored_from_revision?: number | null;
};
type Workspace = { projects: Project[]; control_jobs: ControlJob[]; runner_events: RunnerEvent[]; runners: Runner[]; media: MediaItem[] };
type GitHubStatus = { authenticated: boolean; login?: string | null; oauth_available?: boolean; relay_connected?: boolean; remote?: string | null };
type JsonObject = Record<string, unknown>;
type AnalysisScene = { id: string; at: number; size_bytes: number };
type ProjectAnalysis = {
  status: string;
  media_json: { status?: string; duration?: number; streams?: Array<{ codec_type?: string; width?: number; height?: number; codec_name?: string }> };
  transcript_json: { status?: string; engine?: string; words?: Array<{ start?: number; end?: number; text?: string }>; text?: string; reason?: string };
  thumbnails_json: AnalysisScene[];
  updated_at: string;
};
type MediaProxy = {
  project_id: string;
  asset_id: string;
  source_path: string;
  proxy_path?: string | null;
  status: 'queued' | 'running' | 'ready' | 'failed' | 'cancelled';
  job_id?: string | null;
  progress: number;
  width?: number | null;
  height?: number | null;
  error_text?: string | null;
  updated_at: string;
};
type LocalJob = {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  progress: number;
  error_text?: string | null;
  result_json?: Record<string, unknown> | null;
};
type PublishReceipt = {
  id: string;
  platform: string;
  idempotency_key: string;
  project_id: string;
  status: 'running' | 'succeeded' | 'failed' | 'interrupted';
  result?: Record<string, unknown>;
  error_text?: string | null;
  created_at: string;
  updated_at: string;
};
type LaunchStatus = {
  schema: string;
  app_version: string;
  sidecar: { token_required: boolean; moviepy_installed: boolean };
  publishers: Record<string, { configured?: boolean }>;
  local_gates: Record<string, boolean>;
  external_gates: Record<string, { status: string; ready: boolean; detail: string }>;
};

const defaultMethod = {
  content_type: 'talking_head', target_length: 30, aspect_ratio: '9:16', broll_policy: 'auto',
  hook_strategy: 'payoff_first', pacing: 'tight', filler_policy: 'remove', caption_mode: 'burn_in',
  reframe_anchor: 'center', look: 'natural', audio_policy: 'normalize', speed: 1, fps: 30, quality: 'balanced',
};
const defaultPublish = { schema: 'grok-crew.publish-policy/v1', instagram: 'ask' as PublishMode, tiktok: 'ask' as PublishMode, youtube: 'ask' as PublishMode };

function relativeWorkspacePath(value: string) {
  const normalized = value.replaceAll('\\', '/');
  const marker = '/workspace/';
  const index = normalized.toLowerCase().lastIndexOf(marker);
  return index >= 0 ? normalized.slice(index + marker.length) : normalized;
}

function mediaUrl(path: string) {
  return `${studioBase()}/media/${relativeWorkspacePath(path).split('/').map(encodeURIComponent).join('/')}`;
}

function analysisSceneUrl(projectId: string, sceneId: string, updatedAt: string) {
  return `${studioBase()}/analysis-media/${encodeURIComponent(projectId)}/${encodeURIComponent(sceneId)}?v=${encodeURIComponent(updatedAt)}`;
}

function formatTime(value: number) {
  const safe = Math.max(0, value); const minutes = Math.floor(safe / 60); const seconds = safe - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(1).padStart(4, '0')}`;
}

/** The desktop bridge is installed once by preload, so it never re-emits. */
function subscribeNever() {
  return () => undefined;
}

function hasTimelineBridge() {
  return typeof window !== 'undefined' && typeof window.grokCrew?.applyTimelinePatch === 'function';
}

/** Module scope keeps the bridge identity stable across renders. */
async function desktopTimelinePatchBridge(projectId: string, patch: TimelinePatch) {
  const bridge = typeof window === 'undefined' ? undefined : window.grokCrew;
  if (!bridge) throw new Error('The desktop editing bridge is unavailable.');
  return await bridge.applyTimelinePatch(projectId, patch);
}

function statusTone(status: string) {
  if (['completed', 'rendered', 'succeeded'].includes(status)) return 'done';
  if (['failed', 'cancelled', 'conflict'].includes(status)) return 'error';
  if (['needs_input', 'publish_waiting', 'pause_requested', 'paused'].includes(status)) return 'wait';
  return 'active';
}

export default function DesktopWorkspace() {
  const { t } = useLanguage();
  const [workspace, setWorkspace] = useState<Workspace>({ projects: [], control_jobs: [], runner_events: [], runners: [], media: [] });
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [history, setHistory] = useState<TimelineHistoryState>(() => emptyTimelineHistory());
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [activePanel, setActivePanel] = useState<'setup' | 'edit' | 'export'>('setup');
  const [method, setMethod] = useState({ ...defaultMethod });
  const [publishPolicy, setPublishPolicy] = useState({ ...defaultPublish });
  const [executionPolicy, setExecutionPolicy] = useState<'auto_edit_render' | 'review_before_render'>('auto_edit_render');
  const [message, setMessage] = useState(t('Local Studio에 연결하는 중입니다.', 'Connecting to Local Studio.', '正在连接本地工作室。', 'Local Studio に接続しています。'));
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<ProjectAnalysis | null>(null);
  const [proxies, setProxies] = useState<MediaProxy[]>([]);
  const [proxyJob, setProxyJob] = useState<LocalJob | null>(null);
  const [proxyBusy, setProxyBusy] = useState(false);
  const [useProxy, setUseProxy] = useState(true);
  const [newProject, setNewProject] = useState({ title: '', source_path: '', output_path: 'outputs/final-video.mp4' });
  const [newElement, setNewElement] = useState({ brollPath: '', title: '', caption: '' });
  const [createOpen, setCreateOpen] = useState(false);
  const [previewOutput, setPreviewOutput] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [queueJobs, setQueueJobs] = useState<LocalJob[]>([]);
  const [exchangeText, setExchangeText] = useState('');
  const [github, setGithub] = useState<GitHubStatus>({ authenticated: false, relay_connected: false });
  const [githubToken, setGithubToken] = useState('');
  const [receipts, setReceipts] = useState<PublishReceipt[]>([]);
  const [confirmReceipt, setConfirmReceipt] = useState<PublishReceipt | null>(null);
  const [launch, setLaunch] = useState<LaunchStatus | null>(null);
  const [update, setUpdate] = useState<UpdateStatus>({
    status: 'dev_fallback',
    currentVersion: '0.2.3',
    latestVersion: '0.2.3',
    releaseUrl: '',
    message: 'Browser workspace uses the local tree. Packaged desktop checks GitHub releases.',
  });
  const [studioState, setStudioState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [drawer, setDrawer] = useState<'none' | 'projects' | 'status'>('none');
  const syncingRelay = useRef(false);
  const selectedClipId = selectedClipIds[selectedClipIds.length - 1] ?? '';

  const api = useCallback(async (path: string, init?: RequestInit): Promise<JsonObject> => {
    if (window.grokCrew) return await window.grokCrew.request(path, { method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : null }) as JsonObject;
    const response = await fetch(`${studioBase()}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
    const data = await response.json() as JsonObject;
    if (!response.ok) throw new Error(String(data.error ?? `Local Studio ${response.status}`));
    return data;
  }, []);

  const refreshWorkspace = useCallback(async (quiet = false) => {
    try {
      const next = await api('/api/v2/workspace') as Workspace;
      setWorkspace(next);
      setSelectedProjectId((current) => current || next.projects[0]?.id || '');
      setStudioState('ready');
      if (!quiet) setMessage(t('확인된 최신 상태를 불러왔습니다.', 'Loaded the latest verified state.', '已加载最新确认状态。', '確認済みの最新状態を読み込みました。'));
    } catch (error) {
      setStudioState('error');
      if (!quiet) setMessage(error instanceof Error ? `${error.message} — ${t('npm run local을 먼저 실행하세요.', 'Start npm run local first.', '请先运行 npm run local。', '先に npm run local を実行してください。')}` : t('연결할 수 없습니다.', 'Could not connect.', '无法连接。', '接続できません。'));
    }
  }, [api, t]);

  const refreshProject = useCallback(async (projectId: string) => {
    if (!projectId) { setTimeline(null); setVersions([]); setHistory(emptyTimelineHistory()); setAnalysis(null); setProxies([]); setReceipts([]); return; }
    try {
      const [timelineResponse, versionResponse, historyResponse, proxyResponse, analysisResponse, receiptResponse] = await Promise.all([
        api(`/api/v2/projects/${projectId}/timeline`),
        api(`/api/v2/projects/${projectId}/versions`),
        api(`/api/v2/projects/${projectId}/history`),
        api(`/api/v2/projects/${projectId}/proxies`),
        api(`/api/v2/projects/${projectId}/analysis`),
        api(`/api/v2/projects/${projectId}/publish-receipts`),
      ]);
      setTimeline(timelineResponse.timeline as Timeline); setVersions(versionResponse.versions as Version[]);
      setHistory(historyResponse.history as TimelineHistoryState);
      setProxies(proxyResponse.proxies as MediaProxy[]);
      setAnalysis((analysisResponse.analysis as ProjectAnalysis | null) ?? null);
      setReceipts((receiptResponse.receipts as PublishReceipt[]) ?? []);
      setSelectedClipIds((current) => {
        const valid = new Set((timelineResponse.timeline as Timeline).tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
        return current.filter((clipId) => valid.has(clipId));
      });
    } catch (error) { setMessage(error instanceof Error ? error.message : t('프로젝트를 읽지 못했습니다.', 'Could not read the project.', '无法读取项目。', 'プロジェクトを読み込めませんでした。')); }
  }, [api, t]);

  useEffect(() => { const initial = window.setTimeout(() => void refreshWorkspace(), 0); const interval = window.setInterval(() => void refreshWorkspace(true), 5000); return () => { window.clearTimeout(initial); window.clearInterval(interval); }; }, [refreshWorkspace]);
  useEffect(() => {
    if (!window.grokCrew) return;
    void window.grokCrew.githubStatus().then(setGithub).catch(() => undefined);
  }, []);
  useEffect(() => {
    void api('/api/v2/launch').then((value) => setLaunch(value as LaunchStatus)).catch(() => undefined);
    if (!window.grokCrew?.updateStatus) return;
    void window.grokCrew.updateStatus().then(setUpdate).catch(() => undefined);
  }, [api]);
  useEffect(() => {
    const sync = async () => {
      if (!window.grokCrew || syncingRelay.current) return;
      syncingRelay.current = true;
      try { const result = await window.grokCrew.pullGitResults(); if (result.count > 0) { await refreshWorkspace(true); if (selectedProjectId) await refreshProject(selectedProjectId); } } catch { /* Git relay is optional until connected */ }
      finally { syncingRelay.current = false; }
    };
    const initial = window.setTimeout(() => void sync(), 1_000);
    const interval = window.setInterval(() => void sync(), 5_000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, [refreshProject, refreshWorkspace, selectedProjectId]);
  useEffect(() => { const initial = window.setTimeout(() => void refreshProject(selectedProjectId), 0); return () => window.clearTimeout(initial); }, [refreshProject, selectedProjectId]);
  const visibleReceipts = receipts.filter((receipt) => receipt.project_id === selectedProjectId);

  const project = workspace.projects.find((item) => item.id === selectedProjectId);
  const projectJobs = workspace.control_jobs.filter((job) => job.project_id === selectedProjectId);
  const latestJob = projectJobs[0];
  const latestEvent = latestJob ? workspace.runner_events.find((item) => item.control_job_id === latestJob.id) : undefined;
  const inputRequest = latestJob?.status === 'needs_input' && latestEvent?.stage === 'needs_input' ? latestEvent.detail_json as unknown as NeedsInput : undefined;
  const runner = latestEvent ? workspace.runners.find((item) => item.runner_id === latestEvent.runner_id) : workspace.runners[0];
  const selected = timeline ? findClip(timeline, selectedClipId) : null;
  const outputReady = project ? workspace.media.some((item) => item.area === 'outputs' && relativeWorkspacePath(project.output_path) === item.path) : false;
  const primaryVideoAsset = timeline?.assets.find((asset) => asset.kind === 'video');
  const activeProxy = primaryVideoAsset
    ? proxies.find((proxy) => proxy.asset_id === primaryVideoAsset.id)
    : undefined;
  const proxyReady = activeProxy?.status === 'ready' && Boolean(activeProxy.proxy_path);
  const previewSourcePath = project
    ? (useProxy && proxyReady ? String(activeProxy?.proxy_path) : project.source_path)
    : '';
  const previewPath = project ? (previewOutput && outputReady ? project.output_path : previewSourcePath) : '';
  const analysisVideo = analysis?.media_json.streams?.find((stream) => stream.codec_type === 'video');
  const analysisWords = analysis?.transcript_json.words ?? [];

  // Direct timeline editing goes through the frozen preload bridge only.
  // useSyncExternalStore keeps the server snapshot (`false`) and the desktop
  // snapshot apart without a hydration mismatch.
  const timelineBridgeReady = useSyncExternalStore(subscribeNever, hasTimelineBridge, () => false);

  const onTimelineApplied = (next: Timeline) => {
    setTimeline(next);
    setSelectedClipIds((current) => {
      const clips = next.tracks.flatMap((track) => track.clips);
      return [...new Set(current.flatMap((clipId) => {
        if (clips.some((clip) => clip.id === clipId)) return [clipId];
        // A split replaces one selected clip with two grouped halves.
        return clips.filter((clip) => clip.id.startsWith(`${clipId}-`)).map((clip) => clip.id);
      }))];
    });
    void refreshWorkspace(true);
    if (selectedProjectId) void refreshProject(selectedProjectId);
  };

  const onTimelineReloadRequired = async () => {
    await refreshWorkspace(true);
    if (selectedProjectId) await refreshProject(selectedProjectId);
  };

  const timelineEditing = useTimelineEditing({
    projectId: selectedProjectId,
    timeline,
    createdBy: 'operator',
    bridge: timelineBridgeReady ? desktopTimelinePatchBridge : undefined,
    onApplied: onTimelineApplied,
    onReloadRequired: onTimelineReloadRequired,
  });

  const runTimelineHistoryAction = async (action: TimelineHistoryAction) => {
    if (!selectedProjectId || !timeline || busy || timelineEditing.pending) return;
    setBusy(true);
    try {
      const result = await api(
        `/api/v2/projects/${selectedProjectId}/timeline/history`,
        {
          method: 'POST',
          body: JSON.stringify(buildTimelineHistoryAction(timeline.revision, action)),
        },
      ) as TimelineHistoryResult;
      setTimeline(result.timeline);
      setHistory(result.history);
      setSelectedClipIds((current) => {
        const valid = new Set(result.timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
        return current.filter((clipId) => valid.has(clipId));
      });
      setMessage(action === 'undo'
        ? t(
            `마지막 편집을 취소하고 새 버전 v${result.timeline.revision}으로 저장했습니다.`,
            `Undid the last edit and saved immutable version v${result.timeline.revision}.`,
            `已撤销上次编辑并保存为不可变版本 v${result.timeline.revision}。`,
            `最後の編集を取り消し、不変バージョン v${result.timeline.revision} として保存しました。`,
          )
        : t(
            `취소한 편집을 다시 적용하고 새 버전 v${result.timeline.revision}으로 저장했습니다.`,
            `Redid the edit and saved immutable version v${result.timeline.revision}.`,
            `已重做编辑并保存为不可变版本 v${result.timeline.revision}。`,
            `取り消した編集をやり直し、不変バージョン v${result.timeline.revision} として保存しました。`,
          ));
      await refreshWorkspace(true);
      await refreshProject(selectedProjectId);
    } catch (error) {
      setMessage(error instanceof Error
        ? error.message
        : t('편집 이력을 적용하지 못했습니다.', 'Could not apply edit history.', '无法应用编辑历史。', '編集履歴を適用できませんでした。'));
      await refreshProject(selectedProjectId);
    } finally {
      setBusy(false);
    }
  };

  const createProject = async () => {
    if (!newProject.title.trim() || !newProject.source_path) { setMessage(t('프로젝트 이름과 원본을 선택하세요.', 'Choose a project name and source.', '请选择项目名称和素材。', 'プロジェクト名と素材を選択してください。')); return; }
    setBusy(true);
    try {
      const result = await api('/api/v2/projects', { method: 'POST', body: JSON.stringify({
        title: newProject.title, source_path: newProject.source_path, output_path: newProject.output_path,
        timeline: { clips: [{ in: 0, out: 10, keep: true, caption: '' }], render_settings: { fps: 30, quality: 'balanced', platform: 'reels_tiktok_shorts', captions_enabled: true } }, caption: '',
      }) }) as { project: Project };
      setSelectedProjectId(result.project.id); setCreateOpen(false); setDrawer('none'); setNewProject({ title: '', source_path: '', output_path: 'outputs/final-video.mp4' });
      await refreshWorkspace(true); setMessage(t('프로젝트를 만들었습니다. 설정을 선택해 주세요.', 'Project created. Choose its settings.', '项目已创建，请选择设置。', 'プロジェクトを作成しました。設定を選んでください。'));
    } catch (error) { setMessage(error instanceof Error ? error.message : t('프로젝트 생성에 실패했습니다.', 'Project creation failed.', '项目创建失败。', 'プロジェクト作成に失敗しました。')); } finally { setBusy(false); }
  };

  const importMedia = async () => {
    if (!window.grokCrew) { setMessage(t('파일 가져오기는 데스크톱 앱에서 사용할 수 있습니다.', 'File import is available in the desktop app.', '文件导入仅在桌面应用中可用。', 'ファイル読み込みはデスクトップアプリで利用できます。')); return; }
    setBusy(true);
    try {
      const imported = await window.grokCrew.selectMedia();
      if (!imported) return;
      await refreshWorkspace(true);
      setNewProject((current) => ({ ...current, source_path: imported }));
      setMessage(t('원본을 앱의 로컬 작업 공간으로 가져왔습니다.', 'Imported the source into the app’s local workspace.', '已将素材导入应用的本地工作区。', '素材をアプリのローカルワークスペースに読み込みました。'));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Media import failed.'); } finally { setBusy(false); }
  };

  const patchTimeline = async (operations: Array<Record<string, unknown>>, success?: string) => {
    if (!project || !timeline) return null;
    const result = await api(`/api/v2/projects/${project.id}/timeline/patch`, { method: 'POST', body: JSON.stringify({ schema: 'grok-crew.timeline-patch/v1', base_revision: timeline.revision, origin: 'human', created_by: 'operator', operations }) }) as { timeline: Timeline };
    setTimeline(result.timeline); await refreshWorkspace(true); await refreshProject(project.id);
    if (success) setMessage(success); return result.timeline;
  };

  const saveSettings = async () => {
    if (!project || !timeline) return null;
    setBusy(true);
    try {
      await api('/api/edit-method', { method: 'POST', body: JSON.stringify({ origin: 'human', updated_by: 'operator', method }) });
      const dimensions = method.aspect_ratio === '16:9' ? { width: 1920, height: 1080 } : method.aspect_ratio === '1:1' ? { width: 1080, height: 1080 } : { width: 1080, height: 1920 };
      const next = await patchTimeline([{ op: 'set_settings', changes: {
        ...dimensions, aspect_ratio: method.aspect_ratio, target_length: Number(method.target_length), content_type: method.content_type, broll_policy: method.broll_policy,
        fps: Number(method.fps), quality: method.quality, crop_anchor: method.reframe_anchor, look: method.look, speed: Number(method.speed),
        captions_enabled: method.caption_mode === 'burn_in', normalize_audio: method.audio_policy === 'normalize', mute_audio: method.audio_policy === 'mute',
      } }]);
      setMessage(t('설정을 저장하고 타임라인에 반영했습니다.', 'Settings saved and applied to the timeline.', '设置已保存并应用到时间线。', '設定を保存してタイムラインに反映しました。'));
      return next;
    } catch (error) { setMessage(error instanceof Error ? error.message : t('설정을 저장하지 못했습니다.', 'Could not save settings.', '无法保存设置。', '設定を保存できませんでした。')); return null; } finally { setBusy(false); }
  };

  const startGrok = async () => {
    if (!project || !timeline) { setMessage(t('먼저 프로젝트를 만드세요.', 'Create a project first.', '请先创建项目。', '先にプロジェクトを作成してください。')); return; }
    setBusy(true);
    try {
      const nextTimeline = await saveSettings(); const revision = nextTimeline?.revision ?? timeline.revision;
      const created = await api(`/api/v2/projects/${project.id}/control-jobs`, { method: 'POST', body: JSON.stringify({ base_revision: revision, settings: method, execution_policy: executionPolicy, publish_policy: publishPolicy }) }) as { control_job: ControlJob };
      let delivered = false;
      if (window.grokCrew && workspace.runners.length > 0 && github.relay_connected) {
        await window.grokCrew.pushGitRequest(created.control_job.id);
        delivered = true;
      }
      await refreshWorkspace(true);
      setMessage(delivered
        ? t('암호화 작업을 control 브랜치로 전송했습니다.', 'Encrypted job sent to the control branch.', '加密任务已发送到 control 分支。', '暗号化ジョブを control ブランチへ送信しました。')
        : t('작업을 만들었습니다. Runner 페어링과 GitHub relay 연결 후 전송할 수 있습니다.', 'Job created. Pair a Runner and connect the GitHub relay to send it.', '任务已创建。配对 Runner 并连接 GitHub relay 后即可发送。', 'ジョブを作成しました。Runner と GitHub relay を接続すると送信できます。'));
    } catch (error) { setMessage(error instanceof Error ? error.message : t('작업을 시작하지 못했습니다.', 'Could not start the job.', '无法启动任务。', 'ジョブを開始できませんでした。')); } finally { setBusy(false); }
  };

  const runLocalRender = async () => {
    if (!project) return; setBusy(true);
    try { const result = await api(`/api/projects/${project.id}/render`, { method: 'POST', body: JSON.stringify({ approved: true, requested_by: 'desktop_operator' }) }) as { job: { id: string } }; await api(`/api/jobs/${result.job.id}/run`, { method: 'POST', body: JSON.stringify({}) }); setMessage(t('로컬 렌더를 시작했습니다.', 'Local render started.', '本地渲染已开始。', 'ローカルレンダーを開始しました。')); await refreshWorkspace(true); }
    catch (error) { setMessage(error instanceof Error ? error.message : t('렌더를 시작하지 못했습니다.', 'Could not start render.', '无法开始渲染。', 'レンダーを開始できませんでした。')); } finally { setBusy(false); }
  };
  const enqueueQueuedRender = async () => {
    if (!project) return;
    setBusy(true);
    try {
      const result = await api(`/api/v2/projects/${project.id}/render-queue`, {
        method: 'POST',
        body: JSON.stringify({ approved: true, requested_by: 'desktop_operator', run_immediately: false }),
      }) as { queue: LocalJob[] };
      setQueueJobs(result.queue);
      setMessage(t('렌더를 대기열에 넣었습니다.', 'Queued a render.', '已加入渲染队列。', 'レンダーをキューに追加しました。'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('대기열에 넣지 못했습니다.', 'Could not queue the render.', '无法加入队列。', 'キューに追加できませんでした。'));
    } finally {
      setBusy(false);
    }
  };
  const exportExchange = async (fmt: 'edl' | 'otio') => {
    if (!project) return;
    try {
      const result = await api(`/api/v2/projects/${project.id}/exchange?format=${fmt}`);
      setExchangeText(fmt === 'edl' ? String(result.text ?? '') : JSON.stringify(result.otio, null, 2));
      setMessage(t('교환 파일을 만들었습니다.', 'Built an exchange file.', '已生成交换文件。', '交換ファイルを作成しました。'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('교환 파일을 만들지 못했습니다.', 'Could not export the edit list.', '无法导出交换文件。', '交換ファイルを書き出せませんでした。'));
    }
  };
  const generateProxy = async (force = false) => {
    if (!project || !primaryVideoAsset || proxyBusy) return;
    setProxyBusy(true);
    setMessage(t('저해상도 프록시를 만들고 있습니다.', 'Generating a low-resolution proxy.', '正在生成低分辨率代理文件。', '低解像度プロキシを生成しています。'));
    try {
      const response = await api(`/api/v2/projects/${project.id}/proxies`, {
        method: 'POST',
        body: JSON.stringify({
          asset_id: primaryVideoAsset.id,
          force,
          run_immediately: true,
        }),
      }) as { proxy: MediaProxy; job: LocalJob | null; reused: boolean };
      setProxies((current) => [
        response.proxy,
        ...current.filter((proxy) => proxy.asset_id !== response.proxy.asset_id),
      ]);
      setProxyJob(response.job);
      if (!response.job) {
        setUseProxy(true);
        setMessage(t('기존 프록시를 사용합니다.', 'Using the existing proxy.', '正在使用现有代理文件。', '既存のプロキシを使用します。'));
        return;
      }
      const pollProxyJob = async (jobId: string, attempt = 0): Promise<LocalJob> => {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        const polled = await api(`/api/jobs/${jobId}`) as { job: LocalJob };
        const job = polled.job;
        setProxyJob(job);
        setProxies((current) => current.map((proxy) =>
          proxy.asset_id === primaryVideoAsset.id
            ? { ...proxy, status: job.status === 'succeeded' ? 'ready' : job.status, progress: job.progress, error_text: job.error_text }
            : proxy,
        ));
        if (attempt < 600 && ['queued', 'running'].includes(job.status)) {
          return pollProxyJob(jobId, attempt + 1);
        }
        return job;
      };
      const job = await pollProxyJob(response.job.id);
      await refreshProject(project.id);
      if (job.status === 'succeeded') {
        setUseProxy(true);
        setMessage(t(
          '프록시가 준비되었습니다. 미리보기만 가벼운 파일을 사용하고 최종 렌더는 원본을 사용합니다.',
          'Proxy ready. Preview uses the lighter file; final render still uses the original.',
          '代理文件已就绪。预览使用轻量文件，最终渲染仍使用原片。',
          'プロキシの準備ができました。プレビューのみ軽量ファイルを使い、最終レンダーは元素材を使います。',
        ));
      } else {
        setMessage(job.error_text || t('프록시 생성에 실패했습니다.', 'Proxy generation failed.', '代理文件生成失败。', 'プロキシ生成に失敗しました。'));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('프록시 생성에 실패했습니다.', 'Proxy generation failed.', '代理文件生成失败。', 'プロキシ生成に失敗しました。'));
      if (project) await refreshProject(project.id);
    } finally {
      setProxyBusy(false);
    }
  };
  const cancelProxy = async () => {
    if (!proxyJob || !['queued', 'running'].includes(proxyJob.status)) return;
    await api(`/api/jobs/${proxyJob.id}/cancel`, { method: 'POST', body: '{}' });
    setMessage(t('프록시 생성을 취소하도록 요청했습니다.', 'Requested proxy cancellation.', '已请求取消代理文件生成。', 'プロキシ生成のキャンセルを要求しました。'));
  };
  const analyzeLocal = async () => {
    if (!project) return;
    setAnalyzing(true);
    setMessage(t('원본을 이 PC에서 분석하고 있습니다.', 'Analyzing the source on this PC.', '正在此电脑上分析原片。', 'このPCで素材を解析しています。'));
    try {
      const result = await api(`/api/v2/projects/${project.id}/analysis`, { method: 'POST', body: '{}' }) as { analysis: ProjectAnalysis };
      setAnalysis(result.analysis);
      const transcriptReady = result.analysis.transcript_json?.status === 'ready';
      setMessage(t(
        `로컬 분석 완료: 장면 ${result.analysis.thumbnails_json?.length ?? 0}개${transcriptReady ? ', 대본 준비됨' : '. whisper.cpp 설정 시 대본도 생성됩니다.'}`,
        `Local analysis complete: ${result.analysis.thumbnails_json?.length ?? 0} scenes${transcriptReady ? ' and transcript ready.' : '. Configure whisper.cpp to add a transcript.'}`,
        `本地分析完成：${result.analysis.thumbnails_json?.length ?? 0} 个场景。`,
        `ローカル解析完了：${result.analysis.thumbnails_json?.length ?? 0} シーン。`,
      ));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Local analysis failed.'); } finally { setAnalyzing(false); }
  };

  const updateSelectedClip = async (changes: Record<string, unknown>) => {
    if (!selected) return; try { await patchTimeline([{ op: 'update_clip', clip_id: selected.clip.id, changes }]); } catch (error) { setMessage(error instanceof Error ? error.message : 'Clip update failed.'); }
  };
  // Split from the inspector uses the same operation builder and request queue
  // as the timeline itself, so both paths report identical states.
  const splitSelected = () => {
    if (!selected || !timeline) return;
    const result = buildSplitOperation(timeline, selected.track, selected.clip, selected.clip.timeline_start + selected.clip.duration / 2);
    if (!result.ok) { timelineEditing.reportBlock(result.block); return; }
    void timelineEditing.submit(result.value);
  };
  const removeSelected = async () => { if (!selected) return; try { await patchTimeline([{ op: 'remove_clip', clip_id: selected.clip.id }]); setSelectedClipIds((current) => current.filter((clipId) => clipId !== selected.clip.id)); } catch (error) { setMessage(error instanceof Error ? error.message : 'Remove failed.'); } };
  const addTrack = async (type: TrackType) => { try { await patchTimeline([{ op: 'add_track', track: { id: `${type}-r${(timeline?.revision ?? 0) + 1}`, type, name: type === 'video' ? 'B-roll' : type[0].toUpperCase() + type.slice(1), order: (timeline?.tracks.length ?? 0) * 10, locked: false, muted: false, solo: false, clips: [] } }]); } catch (error) { setMessage(error instanceof Error ? error.message : 'Track creation failed.'); } };
  const addTimelineElement = async (kind: 'broll' | 'title' | 'caption') => {
    if (!timeline) return;
    const revision = timeline.revision + 1;
    const start = selected?.clip.timeline_start ?? 0;
    const duration = Math.max(0.5, Math.min(selected?.clip.duration ?? 3, 5));
    const operations: Array<Record<string, unknown>> = [];
    if (kind === 'broll') {
      const media = workspace.media.find((item) => item.path === newElement.brollPath);
      if (!media) {
        setMessage(t('B-roll 영상을 선택하세요.', 'Choose a B-roll video.', '请选择 B-roll 视频。', 'B-roll 動画を選択してください。'));
        return;
      }
      const assetId = `broll-asset-r${revision}`;
      const existingTrack = timeline.tracks.find((track) => track.type === 'video' && track.id !== 'video-main');
      const trackId = existingTrack?.id ?? `video-broll-r${revision}`;
      operations.push({ op: 'add_asset', asset: { id: assetId, kind: 'video', name: media.name, path: media.path } });
      if (!existingTrack) operations.push({ op: 'add_track', track: { id: trackId, type: 'video', name: 'B-roll', order: timeline.tracks.length * 10, locked: false, muted: false, solo: false, clips: [] } });
      operations.push({ op: 'add_clip', track_id: trackId, clip: {
        id: `broll-clip-r${revision}`, asset_id: assetId, timeline_start: start, duration,
        source_in: 0, source_out: duration, locked: false, transform: {}, audio: { volume: 1, muted: false }, effects: [], keyframes: {},
      } });
    } else if (kind === 'title') {
      const text = newElement.title.trim();
      if (!text) return;
      const assetId = `title-asset-r${revision}`;
      const existingTrack = timeline.tracks.find((track) => track.type === 'overlay');
      const trackId = existingTrack?.id ?? `overlay-title-r${revision}`;
      operations.push({ op: 'add_asset', asset: { id: assetId, kind: 'title', name: text.slice(0, 60), text } });
      if (!existingTrack) operations.push({ op: 'add_track', track: { id: trackId, type: 'overlay', name: 'Titles', order: timeline.tracks.length * 10, locked: false, muted: false, solo: false, clips: [] } });
      operations.push({ op: 'add_clip', track_id: trackId, clip: {
        id: `title-clip-r${revision}`, asset_id: assetId, timeline_start: start, duration,
        locked: false, text, transform: { scale: 1, opacity: 1 }, style: { size: 92, color: '#FFFFFF' }, effects: [], keyframes: {},
      } });
    } else {
      const text = newElement.caption.trim();
      if (!text) return;
      const existingTrack = timeline.tracks.find((track) => track.type === 'caption');
      const trackId = existingTrack?.id ?? `caption-r${revision}`;
      if (!existingTrack) operations.push({ op: 'add_track', track: { id: trackId, type: 'caption', name: 'Captions', order: timeline.tracks.length * 10, locked: false, muted: false, solo: false, clips: [] } });
      operations.push({ op: 'add_clip', track_id: trackId, clip: {
        id: `caption-clip-r${revision}`, asset_id: null, timeline_start: start, duration,
        locked: false, text, style: { position_y: 78, size: 72 }, effects: [], keyframes: {},
      } });
    }
    try {
      await patchTimeline(operations);
      setNewElement((current) => ({ ...current, ...(kind === 'broll' ? { brollPath: '' } : kind === 'title' ? { title: '' } : { caption: '' }) }));
      setMessage(t('편집 요소를 새 타임라인 버전에 추가했습니다.', 'Added the element in a new timeline version.', '已在新的时间线版本中添加编辑元素。', '編集要素を新しいタイムラインバージョンに追加しました。'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not add timeline element.');
    }
  };
  const relayAction = async (action: 'pair' | 'desktop' | 'request' | 'result' | 'git-connect' | 'git-push' | 'git-pull') => {
    if (!window.grokCrew) { setMessage(t('Runner 연결은 데스크톱 앱에서 사용할 수 있습니다.', 'Runner pairing is available in the desktop app.', 'Runner 配对仅在桌面应用中可用。', 'Runner ペアリングはデスクトップアプリで利用できます。')); return; }
    try {
      if (action === 'pair') await window.grokCrew.pairRunner();
      else if (action === 'desktop') await window.grokCrew.exportDesktopPairing();
      else if (action === 'request' && latestJob) await window.grokCrew.exportRunnerRequest(latestJob.id);
      else if (action === 'result') await window.grokCrew.importRunnerResult();
      else if (action === 'git-connect') { await window.grokCrew.connectGitRelay(); setGithub(await window.grokCrew.githubStatus()); }
      else if (action === 'git-push' && latestJob) await window.grokCrew.pushGitRequest(latestJob.id);
      else if (action === 'git-pull') await window.grokCrew.pullGitResults();
      await refreshWorkspace(true);
      setMessage(t('암호화된 Runner 전달 작업을 완료했습니다.', 'Encrypted Runner handoff completed.', '已完成加密的 Runner 交接。', '暗号化された Runner 引き継ぎが完了しました。'));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Runner relay failed.'); }
  };
  const loginGitHub = async (mode: 'device' | 'token') => {
    if (!window.grokCrew) return;
    setBusy(true);
    try {
      const next = mode === 'device'
        ? await window.grokCrew.loginGitHubDevice()
        : await window.grokCrew.loginGitHubToken(githubToken);
      if (next) setGithub({ ...github, ...next });
      setGithubToken('');
      setMessage(t('GitHub 자격 증명을 OS 보안 저장소에 저장했습니다.', 'GitHub credentials saved in the OS secure store.', 'GitHub 凭据已保存到系统安全存储。', 'GitHub 認証情報を OS の安全な保管領域に保存しました。'));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'GitHub login failed.'); }
    finally { setBusy(false); }
  };
  const controlRunnerJob = async (command: 'cancel' | 'pause' | 'resume' | 'retry') => {
    if (!window.grokCrew || !latestJob) return;
    setBusy(true);
    try {
      await window.grokCrew.controlRunnerJob(latestJob.id, command);
      await refreshWorkspace(true);
      setMessage(t(`원격 ${command} 명령을 서명해 control 브랜치로 보냈습니다.`, `Signed remote ${command} command sent to the control branch.`, `已将签名的远程 ${command} 命令发送到 control 分支。`, `署名済みのリモート ${command} コマンドを control ブランチへ送信しました。`));
    } catch (error) { setMessage(error instanceof Error ? error.message : `Could not ${command} the Runner job.`); }
    finally { setBusy(false); }
  };
  const resolveConflict = async (action: 'discard' | 'retry_current') => {
    if (!window.grokCrew || !latestJob) return;
    setBusy(true);
    try {
      await window.grokCrew.resolveRunnerConflict(latestJob.id, action);
      await refreshWorkspace(true);
      setMessage(action === 'retry_current'
        ? t('현재 타임라인 revision으로 Grok에 다시 요청했습니다.', 'Retried Grok against the current timeline revision.', '已基于当前时间线版本重新请求 Grok。', '現在のタイムライン revision で Grok に再依頼しました。')
        : t('충돌 편집안을 폐기했습니다.', 'Discarded the conflicted proposal.', '已放弃冲突的编辑方案。', '競合した提案を破棄しました。'));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Conflict resolution failed.'); }
    finally { setBusy(false); }
  };
  const answerRunnerInput = async (value: string) => {
    if (!window.grokCrew || !latestJob || !inputRequest) return;
    setBusy(true);
    try {
      await window.grokCrew.answerRunnerInput(latestJob.id, { question_id: inputRequest.question_id, value });
      await refreshWorkspace(true);
      setMessage(t('선택을 저장하고 같은 Grok 세션으로 보낼 암호화 요청을 만들었습니다.', 'Saved the choice and exported an encrypted follow-up for the same Grok session.', '已保存选择并导出同一 Grok 会话的加密后续请求。', '選択を保存し、同じ Grok セッションへの暗号化フォローアップを書き出しました。'));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not send the answer.'); } finally { setBusy(false); }
  };
  const publishNow = async (platform: 'instagram' | 'tiktok' | 'youtube') => {
    if (!project || !timeline || !outputReady) return;
    if (publishPolicy[platform] === 'export_only') { setMessage(t('이 플랫폼은 파일 내보내기 전용입니다.', 'This platform is set to export only.', '该平台设置为仅导出。', 'このプラットフォームは書き出しのみです。')); return; }
    setBusy(true);
    try {
      await api(`/api/v2/projects/${project.id}/publish/${platform}`, { method: 'POST', body: JSON.stringify({
        approved: true, run_immediately: true, render_path: relativeWorkspacePath(project.output_path),
        idempotency_key: `${project.id}:${platform}:v${timeline.revision}`,
        privacy_level: platform === 'tiktok' ? 'SELF_ONLY' : undefined,
        privacy_status: platform === 'youtube' ? 'private' : undefined,
      }) });
      setMessage(t('게시 작업을 시작했습니다. 플랫폼 상태는 독립적으로 기록됩니다.', 'Publishing started. Each platform is tracked independently.', '发布任务已开始，各平台独立跟踪。', '公開処理を開始しました。各プラットフォームは個別に追跡されます。'));
      await refreshProject(project.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Publish failed.'); } finally { setBusy(false); }
  };
  const retryReceipt = async (receipt: PublishReceipt, confirmed = false) => {
    if (!project || receipt.project_id !== project.id) return;
    if (receipt.status === 'interrupted' && !confirmed) {
      setConfirmReceipt(receipt);
      return;
    }
    setConfirmReceipt(null);
    setBusy(true);
    try {
      const payload = await api(`/api/v2/projects/${project.id}/publish-receipts/retry`, {
        method: 'POST',
        body: JSON.stringify({ receipt_id: receipt.id, approved: true }),
      }) as { result?: { possible_duplicate?: boolean } };
      await refreshProject(project.id);
      setMessage(payload.result?.possible_duplicate
        ? t('재시도했습니다. 플랫폼이 이미 첫 업로드를 받았다면 영상이 하나 더 올라갈 수 있습니다.', 'Retried. If the platform already accepted the first upload, a second copy may appear.', '已重试。如果平台已接受第一次上传，可能会出现第二份。', '再試行しました。最初のアップロードが受理済みなら、もう1本増えることがあります。')
        : t('게시를 다시 시도했습니다.', 'Retried the publish.', '已重试发布。', '公開を再試行しました。'));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Retry failed.'); } finally { setBusy(false); }
  };

  return (
    <main className="desktop-shell">
      <header className="desktop-titlebar">
        <div className="desktop-brand"><span className="desktop-logo">G</span><div><b>Grok Crew</b><small>{t('로컬 제작 데스크', 'Desktop Production', '本地制作台', 'デスクトップ制作')}</small></div></div>
        <nav aria-label={t('작업 패널', 'Workspace panels', '工作面板', '作業パネル')}>
          <button type="button" className={activePanel === 'setup' ? 'active' : ''} aria-current={activePanel === 'setup' ? 'page' : undefined} onClick={() => setActivePanel('setup')}>{t('설정', 'Setup', '设置', '設定')}</button>
          <button type="button" className={activePanel === 'edit' ? 'active' : ''} aria-current={activePanel === 'edit' ? 'page' : undefined} onClick={() => setActivePanel('edit')}>{t('편집', 'Edit', '编辑', '編集')}</button>
          <button type="button" className={activePanel === 'export' ? 'active' : ''} aria-current={activePanel === 'export' ? 'page' : undefined} onClick={() => setActivePanel('export')}>{t('내보내기', 'Export', '导出', '書き出し')}</button>
        </nav>
        <div className="desktop-title-actions">
          {update.releaseUrl && window.grokCrew?.openRelease
            ? <button type="button" className={`desktop-chip ${update.status === 'up_to_date' || update.status === 'dev_fallback' ? 'ready' : 'wait'}`} title={update.message} onClick={() => void window.grokCrew?.openRelease?.(update.releaseUrl)}>{update.status === 'available_external' || update.status === 'available' ? t(`업데이트 ${update.latestVersion}`, `Update ${update.latestVersion}`, `更新 ${update.latestVersion}`, `更新 ${update.latestVersion}`) : t(`개발 ${update.currentVersion}`, `Dev ${update.currentVersion}`, `开发 ${update.currentVersion}`, `開発 ${update.currentVersion}`)}</button>
            : <span className={`desktop-chip ${update.status === 'up_to_date' || update.status === 'dev_fallback' ? 'ready' : 'wait'}`} title={update.message}>{t(`로컬 ${update.currentVersion}`, `Local ${update.currentVersion}`, `本地 ${update.currentVersion}`, `ローカル ${update.currentVersion}`)}</span>}
          {launch ? <span className={`desktop-chip ${Object.values(launch.local_gates).every(Boolean) ? 'ready' : 'wait'}`} title={Object.values(launch.external_gates).map((gate) => gate.detail).join(' ')}>{t('로컬 1.0 게이트', 'Local 1.0 gates', '本地 1.0 关卡', 'ローカル 1.0 ゲート')}</span> : <span className="desktop-chip desktop-chip-skeleton" aria-hidden="true">{t('게이트 확인', 'Checking gates', '正在检查关卡', 'ゲート確認')}</span>}
          <span className={`desktop-connection ${runner ? 'connected' : ''}`}>● {runner ? t('Runner 페어링됨', 'Runner paired', 'Runner 已配对', 'Runner ペアリング済み') : t('Runner 대기', 'Waiting for Runner', '等待 Runner', 'Runner 待機')}</span>
          <button type="button" className="desktop-chrome-btn desktop-projects-toggle" aria-expanded={drawer === 'projects'} onClick={() => setDrawer((value) => value === 'projects' ? 'none' : 'projects')}>{t('프로젝트', 'Projects', '项目', 'プロジェクト')}</button>
          <button type="button" className="desktop-chrome-btn desktop-status-toggle" aria-expanded={drawer === 'status'} onClick={() => setDrawer((value) => value === 'status' ? 'none' : 'status')}>{t('상태', 'Status', '状态', '状態')}</button>
          <LanguageSwitcher />
        </div>
      </header>
      {drawer !== 'none' ? <button type="button" className="desktop-drawer-backdrop" aria-label={t('패널 닫기', 'Close panel', '关闭面板', 'パネルを閉じる')} onClick={() => setDrawer('none')} /> : null}

      <div className="desktop-body">
        <aside className={`desktop-sidebar ${drawer === 'projects' ? 'open' : ''}`}>
          <div className="desktop-side-head"><b>{t('프로젝트', 'Projects', '项目', 'プロジェクト')}</b><button type="button" aria-label={t('새 프로젝트', 'New project', '新建项目', '新規プロジェクト')} onClick={() => setCreateOpen((value) => !value)}>＋</button></div>
          {createOpen && <section className="desktop-create-card"><input value={newProject.title} onChange={(event) => setNewProject({ ...newProject, title: event.target.value })} placeholder={t('프로젝트 이름', 'Project name', '项目名称', 'プロジェクト名')} /><select value={newProject.source_path} onChange={(event) => setNewProject({ ...newProject, source_path: event.target.value })}><option value="">{t('원본 선택', 'Choose source', '选择素材', '素材を選択')}</option>{workspace.media.filter((item) => item.kind === 'video' && item.area === 'inputs').map((item) => <option value={item.path} key={item.path}>{item.name}</option>)}</select><button className="desktop-secondary" disabled={busy} onClick={() => void importMedia()}>{t('내 컴퓨터에서 가져오기', 'Import from computer', '从电脑导入', 'コンピュータから読み込む')}</button><input value={newProject.output_path} onChange={(event) => setNewProject({ ...newProject, output_path: event.target.value })} /><button className="desktop-primary" disabled={busy} onClick={() => void createProject()}>{t('만들기', 'Create', '创建', '作成')}</button></section>}
          <div className="desktop-project-list">{workspace.projects.map((item) => <button className={item.id === selectedProjectId ? 'active' : ''} key={item.id} onClick={() => { setSelectedProjectId(item.id); setDrawer('none'); }}><span>▣</span><div><b>{item.title}</b><small>v{item.current_revision} · {new Date(item.updated_at).toLocaleDateString()}</small></div></button>)}{studioState === 'loading' && !workspace.projects.length ? <p className="desktop-side-empty">{t('Local Studio에 연결하는 중…', 'Connecting to Local Studio…', '正在连接本地工作室…', 'Local Studio に接続しています…')}</p> : null}{studioState === 'error' && !workspace.projects.length ? <p className="desktop-side-empty">{t('연결하지 못했습니다. 다시 시도하세요.', 'Could not connect. Retry from the banner.', '无法连接。请从横幅重试。', '接続できません。バナーから再試行してください。')}</p> : null}{studioState === 'ready' && !workspace.projects.length ? <div className="desktop-side-empty"><p>{t('아직 프로젝트가 없습니다.', 'No projects yet.', '暂无项目。', 'プロジェクトはまだありません。')}</p><button type="button" className="desktop-secondary" onClick={() => setCreateOpen(true)}>{t('첫 프로젝트 만들기', 'Create the first project', '创建第一个项目', '最初のプロジェクトを作成')}</button></div> : null}</div>
          <div className="desktop-side-head desktop-version-head"><b>{t('버전 기록', 'Versions', '版本', 'バージョン')}</b><span>{versions.length}</span></div>
          <div className="desktop-version-list">{!versions.length ? <p className="desktop-side-empty">{project ? t('이 프로젝트의 버전은 아직 없습니다.', 'No versions for this project yet.', '此项目还没有版本。', 'このプロジェクトのバージョンはまだありません。') : t('프로젝트를 열면 버전 기록이 여기에 쌓입니다.', 'Open a project to collect version history here.', '打开项目后版本会显示在这里。', 'プロジェクトを開くと履歴がここに残ります。')}</p> : null}{versions.slice(0, 8).map((version, index) => (
            <button
              key={version.id}
              title={version.restored_from_revision ? `v${version.restored_from_revision}` : undefined}
              onClick={() => index
                ? void api(`/api/v2/projects/${selectedProjectId}/timeline/restore`, {
                    method: 'POST',
                    body: JSON.stringify({ revision: version.revision }),
                  }).then(() => refreshProject(selectedProjectId))
                : undefined}
            >
              <b>v{version.revision}</b>
              <span>
                {version.action_kind === 'undo'
                  ? t('실행 취소', 'Undo', '撤销', '取り消し')
                  : version.action_kind === 'redo'
                    ? t('다시 실행', 'Redo', '重做', 'やり直し')
                    : version.action_kind === 'restore'
                      ? t('버전 복원', 'Restore', '恢复版本', 'バージョン復元')
                      : version.origin === 'remote_bot'
                        ? 'Grok'
                        : version.origin === 'human'
                          ? t('사용자', 'You', '用户', 'ユーザー')
                          : t('시스템', 'System', '系统', 'システム')}
              </span>
              {index > 0 && <small>{t('복원', 'Restore', '恢复', '復元')}</small>}
            </button>
          ))}</div>
          <a className="desktop-legacy" href="/production">{t('고급·레거시 도구', 'Advanced & legacy tools', '高级与旧版工具', '高度・レガシーツール')} ↗</a>
        </aside>

        <section className="desktop-stage">
          {studioState === 'error' && project ? <div className="desktop-banner error" role="alert"><div><b>{t('Local Studio에 연결하지 못했습니다', 'Could not reach Local Studio', '无法连接 Local Studio', 'Local Studio に接続できません')}</b><p>{t('사이드카가 꺼져 있으면 프로젝트와 렌더를 읽을 수 없습니다.', 'The sidecar is offline, so projects and renders cannot load.', '侧车离线时无法读取项目和渲染。', 'サイドカーが停止しているとプロジェクトとレンダーを読めません。')}</p></div><button type="button" className="desktop-secondary" onClick={() => void refreshWorkspace()}>{t('다시 연결', 'Reconnect', '重新连接', '再接続')}</button></div> : null}
          {studioState === 'loading' && !project ? <div className="desktop-empty" aria-busy="true"><span className="desktop-spinner" /><h1>{t('작업 공간을 불러오는 중', 'Loading the workspace', '正在加载工作区', 'ワークスペースを読み込み中')}</h1><p>{t('Local Studio의 프로젝트와 게시 영수증을 확인합니다.', 'Checking Local Studio projects and publish receipts.', '正在检查本地工作室项目和发布回执。', 'Local Studio のプロジェクトと公開レシートを確認しています。')}</p></div>
          : studioState === 'error' && !project ? <div className="desktop-empty"><span>!</span><h1>{t('데스크톱이 로컬 서비스에 닿지 않습니다', 'The desktop cannot reach the local service', '桌面无法连接本地服务', 'デスクトップがローカルサービスに届きません')}</h1><p>{t('npm run local 또는 데스크톱 앱을 실행한 뒤 다시 연결하세요.', 'Start npm run local or the desktop app, then reconnect.', '请先运行 npm run local 或桌面应用，然后重试。', 'npm run local かデスクトップアプリを起動してから再接続してください。')}</p><button type="button" className="desktop-primary" onClick={() => void refreshWorkspace()}>{t('다시 시도', 'Try again', '重试', '再試行')}</button></div>
          : !project || !timeline ? <div className="desktop-empty"><span>✦</span><h1>{t('첫 영상 프로젝트를 만드세요', 'Create your first video project', '创建第一个视频项目', '最初の動画プロジェクトを作成')}</h1><p>{t('workspace/inputs의 원본을 고르면 설정·편집·내보내기가 같은 화면에 열립니다.', 'Pick a source from workspace/inputs to open setup, edit, and export on one desk.', '从 workspace/inputs 选择素材后，设置、编辑和导出会在同一屏幕打开。', 'workspace/inputs の素材を選ぶと設定・編集・書き出しが同じ画面で開きます。')}</p><button type="button" className="desktop-primary" onClick={() => { setCreateOpen(true); setDrawer('projects'); }}>{t('프로젝트 만들기', 'Create a project', '创建项目', 'プロジェクトを作成')}</button></div> : <>
            <div className="desktop-project-bar"><div><small>{t('현재 프로젝트', 'CURRENT PROJECT', '当前项目', '現在のプロジェクト')}</small><h1>{project.title}</h1></div><div className="desktop-project-chips"><span>v{timeline.revision}</span><span>{timeline.settings.width}×{timeline.settings.height}</span><span>{timeline.settings.fps}fps</span></div></div>
            {activePanel === 'setup' && <div className="desktop-setup-grid">
              <section className="desktop-card desktop-source-card">
                <div className="desktop-card-title"><span>01</span><div><b>{t('원본과 결과', 'Source & output', '素材与输出', '素材と出力')}</b><small>{relativeWorkspacePath(project.source_path)}</small></div></div>
                <video controls preload="metadata" src={mediaUrl(project.source_path)} />
                <div className="desktop-source-meta"><span>{t('원본은 이 PC에 유지됩니다', 'Original stays on this PC', '原片保留在此电脑', '原本はこのPCに保持')}</span><span>{relativeWorkspacePath(project.output_path)}</span></div>
                <button className="desktop-secondary" disabled={busy || analyzing} onClick={() => void analyzeLocal()}>{analyzing ? t('분석 중…', 'Analyzing…', '分析中…', '解析中…') : t('로컬 대본·장면 분석', 'Analyze transcript & scenes locally', '本地分析字幕和场景', 'ローカルで字幕・シーン解析')}</button>
                {analysis && <div className="desktop-analysis" aria-live="polite">
                  <div className="desktop-analysis-head"><div><b>{t('로컬 분석 결과', 'Local analysis results', '本地分析结果', 'ローカル解析結果')}</b><small>{new Date(analysis.updated_at).toLocaleString()}</small></div><span>✓ {analysis.thumbnails_json.length} {t('개 장면', 'scenes', '个场景', 'シーン')}</span></div>
                  <div className="desktop-analysis-facts">
                    <span><b>{t('길이', 'Duration', '时长', '長さ')}</b>{formatTime(Number(analysis.media_json.duration ?? 0))}</span>
                    <span><b>{t('화면', 'Frame', '画面', '画面')}</b>{analysisVideo?.width && analysisVideo?.height ? `${analysisVideo.width}×${analysisVideo.height}` : '—'}</span>
                    <span><b>{t('대본', 'Transcript', '字幕稿', '文字起こし')}</b>{analysis.transcript_json.status === 'ready' ? `${analysisWords.length} ${t('개 구간', 'segments', '个片段', '区間')}` : t('미설정', 'Not configured', '未配置', '未設定')}</span>
                  </div>
                  {!!analysis.thumbnails_json.length && <div className="desktop-scene-grid">{analysis.thumbnails_json.map((scene, index) => <figure key={scene.id}>
                    {/* Generated analysis thumbnails are served only by the loopback sidecar. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={analysisSceneUrl(project.id, scene.id, analysis.updated_at)} alt={t(`장면 ${index + 1}`, `Scene ${index + 1}`, `场景 ${index + 1}`, `シーン ${index + 1}`)} />
                    <figcaption><span>{String(index + 1).padStart(2, '0')}</span><time>{formatTime(scene.at)}</time></figcaption>
                  </figure>)}</div>}
                  <div className={`desktop-transcript-state ${analysis.transcript_json.status === 'ready' ? 'ready' : ''}`}><span>{analysis.transcript_json.status === 'ready' ? '✓' : 'i'}</span><div><b>{analysis.transcript_json.status === 'ready' ? t('대본 준비됨', 'Transcript ready', '字幕稿已就绪', '文字起こし準備完了') : t('장면 분석만 완료됨', 'Scene analysis complete', '场景分析已完成', 'シーン解析のみ完了')}</b><p>{analysis.transcript_json.status === 'ready' ? (analysis.transcript_json.text || analysisWords.map((word) => word.text).join(' ')) : t('whisper.cpp를 설정하면 음성을 대본으로 변환합니다.', 'Configure whisper.cpp to transcribe speech.', '配置 whisper.cpp 后可将语音转成文字。', 'whisper.cpp を設定すると音声を文字起こしできます。')}</p></div></div>
                </div>}
              </section>
              <section className="desktop-card desktop-settings-card"><div className="desktop-card-title"><span>02</span><div><b>{t('Grok 편집 설정', 'Grok edit controls', 'Grok 编辑设置', 'Grok 編集設定')}</b><small>{t('채팅 없이 명확한 선택으로 전달합니다.', 'Clear controls, no prompt writing.', '无需编写提示词。', 'プロンプト入力は不要です。')}</small></div></div><div className="desktop-form-grid">
                <label>{t('콘텐츠 유형', 'Content type', '内容类型', 'コンテンツ種別')}<select value={method.content_type} onChange={(e) => setMethod({ ...method, content_type: e.target.value })}><option value="talking_head">{t('토킹헤드', 'Talking head', '口播', 'トーキングヘッド')}</option><option value="vlog">Vlog</option><option value="product">{t('제품·서비스', 'Product / service', '产品服务', '製品・サービス')}</option><option value="tutorial">{t('튜토리얼', 'Tutorial', '教程', 'チュートリアル')}</option></select></label>
                <label>{t('목표 길이', 'Target length', '目标时长', '目標尺')}<select value={method.target_length} onChange={(e) => setMethod({ ...method, target_length: Number(e.target.value) })}><option value="15">15s</option><option value="30">30s</option><option value="45">45s</option><option value="60">60s</option><option value="90">90s</option></select></label>
                <label>{t('화면비', 'Aspect ratio', '画面比例', 'アスペクト比')}<select value={method.aspect_ratio} onChange={(e) => setMethod({ ...method, aspect_ratio: e.target.value })}><option value="9:16">9:16</option><option value="1:1">1:1</option><option value="16:9">16:9</option></select></label>
                <label>B-roll<select value={method.broll_policy} onChange={(e) => setMethod({ ...method, broll_policy: e.target.value })}><option value="auto">{t('필요할 때 제안', 'Suggest when useful', '按需建议', '必要時に提案')}</option><option value="required">{t('적극 사용', 'Use actively', '积极使用', '積極的に使用')}</option><option value="off">{t('사용 안 함', 'Off', '关闭', 'オフ')}</option></select></label>
                <label>{t('훅', 'Hook', '开场', 'フック')}<select value={method.hook_strategy} onChange={(e) => setMethod({ ...method, hook_strategy: e.target.value })}><option value="payoff_first">{t('결과 먼저', 'Payoff first', '结果优先', '結果を先に')}</option><option value="question_first">{t('질문 먼저', 'Question first', '问题优先', '質問を先に')}</option><option value="chronological">{t('순서대로', 'Chronological', '按时间顺序', '時系列')}</option></select></label>
                <label>{t('속도감', 'Pacing', '节奏', 'テンポ')}<select value={method.pacing} onChange={(e) => setMethod({ ...method, pacing: e.target.value })}><option value="tight">{t('빠르고 타이트', 'Tight', '紧凑', 'タイト')}</option><option value="balanced">{t('균형', 'Balanced', '平衡', 'バランス')}</option><option value="deliberate">{t('차분하게', 'Deliberate', '沉稳', '丁寧')}</option></select></label>
                <label>{t('군더더기', 'Filler', '冗余', 'フィラー')}<select value={method.filler_policy} onChange={(e) => setMethod({ ...method, filler_policy: e.target.value })}><option value="remove">{t('자동 제거', 'Remove', '删除', '削除')}</option><option value="review">{t('검토 표시', 'Flag for review', '标记审核', '要確認')}</option><option value="keep">{t('유지', 'Keep', '保留', '維持')}</option></select></label>
                <label>{t('자막', 'Captions', '字幕', '字幕')}<select value={method.caption_mode} onChange={(e) => setMethod({ ...method, caption_mode: e.target.value })}><option value="burn_in">{t('영상에 포함', 'Burn in', '嵌入视频', '焼き込み')}</option><option value="off">{t('끄기', 'Off', '关闭', 'オフ')}</option></select></label>
                <label>{t('화면 중심', 'Reframe', '重构图', 'リフレーム')}<select value={method.reframe_anchor} onChange={(e) => setMethod({ ...method, reframe_anchor: e.target.value })}><option value="left">{t('왼쪽', 'Left', '左', '左')}</option><option value="center">{t('가운데', 'Center', '中', '中央')}</option><option value="right">{t('오른쪽', 'Right', '右', '右')}</option></select></label>
                <label>{t('룩', 'Look', '画面风格', 'ルック')}<select value={method.look} onChange={(e) => setMethod({ ...method, look: e.target.value })}><option value="natural">Natural</option><option value="punchy">Punchy</option><option value="mono">Mono</option><option value="night">Night</option></select></label>
                <label>{t('오디오', 'Audio', '音频', 'オーディオ')}<select value={method.audio_policy} onChange={(e) => setMethod({ ...method, audio_policy: e.target.value })}><option value="preserve">{t('원본 유지', 'Preserve', '保留原音', '原音')}</option><option value="normalize">{t('음량 정리', 'Normalize', '标准化', '正規化')}</option><option value="mute">{t('음소거', 'Mute', '静音', 'ミュート')}</option></select></label>
                <label>FPS<select value={method.fps} onChange={(e) => setMethod({ ...method, fps: Number(e.target.value) })}><option>24</option><option>30</option><option>60</option></select></label>
                <label>{t('품질', 'Quality', '质量', '品質')}<select value={method.quality} onChange={(e) => setMethod({ ...method, quality: e.target.value })}><option value="compact">Compact</option><option value="balanced">Balanced</option><option value="high">High</option></select></label>
                <label className="desktop-wide">{t('전체 속도', 'Overall speed', '整体速度', '全体速度')}<div className="desktop-range"><input type="range" min="0.5" max="2" step="0.05" value={method.speed} onChange={(e) => setMethod({ ...method, speed: Number(e.target.value) })} /><output>{Number(method.speed).toFixed(2)}×</output></div></label>
              </div><button className="desktop-secondary" disabled={busy} onClick={() => void saveSettings()}>{t('설정만 저장', 'Save controls', '保存设置', '設定を保存')}</button></section>
              <section className="desktop-card desktop-policy-card"><div className="desktop-card-title"><span>03</span><div><b>{t('자동화 범위', 'Automation', '自动化范围', '自動化範囲')}</b><small>{t('렌더와 게시 권한을 각각 정합니다.', 'Choose render and publishing authority.', '分别设置渲染和发布权限。', 'レンダーと公開を個別に設定。')}</small></div></div><label className="desktop-radio"><input type="radio" checked={executionPolicy === 'auto_edit_render'} onChange={() => setExecutionPolicy('auto_edit_render')} /><span><b>{t('자동 편집 + 렌더', 'Auto edit + render', '自动编辑和渲染', '自動編集＋レンダー')}</b><small>{t('새 버전을 만들고 바로 렌더합니다.', 'Create a new version and render it.', '创建新版本并渲染。', '新しいバージョンを作成してレンダー。')}</small></span></label><label className="desktop-radio"><input type="radio" checked={executionPolicy === 'review_before_render'} onChange={() => setExecutionPolicy('review_before_render')} /><span><b>{t('편집안 먼저 검토', 'Review before render', '渲染前审核', 'レンダー前に確認')}</b><small>{t('타임라인 변경을 확인할 때 멈춥니다.', 'Pause when the proposal is ready.', '编辑方案完成后暂停。', '提案の準備後に一時停止。')}</small></span></label></section>
            </div>}

            {activePanel === 'edit' && <div className="desktop-editor">
              <ProgramMonitor
                projectId={project.id}
                playhead={playhead}
                request={api}
                sourceFallback={mediaUrl(previewPath)}
                previewOutput={previewOutput}
                outputReady={outputReady}
                onToggleOutput={() => setPreviewOutput((value) => !value)}
                actions={(
                  <>
                    {primaryVideoAsset && !proxyReady && !proxyBusy ? (
                      <button onClick={() => void generateProxy(activeProxy?.status === 'failed')}>
                        {activeProxy?.status === 'failed'
                          ? t('프록시 다시 만들기', 'Retry proxy', '重试代理文件', 'プロキシ再試行')
                          : t('프록시 만들기', 'Generate proxy', '生成代理文件', 'プロキシ作成')}
                      </button>
                    ) : null}
                    {proxyBusy ? (
                      <>
                        <span>{t('프록시 생성', 'Proxy', '代理文件', 'プロキシ')} {proxyJob?.progress ?? activeProxy?.progress ?? 0}%</span>
                        <button onClick={() => void cancelProxy()}>{t('취소', 'Cancel', '取消', 'キャンセル')}</button>
                      </>
                    ) : null}
                    {proxyReady && !previewOutput ? (
                      <button
                        className={useProxy ? 'active' : ''}
                        aria-pressed={useProxy}
                        onClick={() => setUseProxy((value) => !value)}
                      >
                        {useProxy
                          ? t('프록시 사용 중', 'Using proxy', '正在使用代理', 'プロキシ使用中')
                          : t('원본 미리보기', 'Original preview', '原片预览', '元素材プレビュー')}
                      </button>
                    ) : null}
                  </>
                )}
              />
            </div>}

            {activePanel === 'export' && <div className="desktop-export-grid"><section className="desktop-card"><div className="desktop-card-title"><span>01</span><div><b>{t('플랫폼 게시 정책', 'Publishing policy', '发布策略', '公開ポリシー')}</b><small>{t('기본은 확인 후 게시입니다.', 'Default: ask before publishing.', '默认发布前确认。', '初期値は公開前に確認。')}</small></div></div>{(['instagram', 'tiktok', 'youtube'] as const).map((platform) => <div className="desktop-publish-row" key={platform}><b>{platform === 'youtube' ? 'YouTube Shorts' : platform[0].toUpperCase() + platform.slice(1)}</b><select aria-label={`${platform} publish policy`} value={publishPolicy[platform]} onChange={(e) => setPublishPolicy({ ...publishPolicy, [platform]: e.target.value as PublishMode })}><option value="export_only">{t('파일만 내보내기', 'Export only', '仅导出', '書き出しのみ')}</option><option value="ask">{t('게시 전 확인', 'Ask before posting', '发布前确认', '公開前に確認')}</option><option value="auto">{t('자동 게시', 'Auto publish', '自动发布', '自動公開')}</option></select><button disabled={busy || !outputReady || publishPolicy[platform] === 'export_only'} onClick={() => void publishNow(platform)}>{t('게시', 'Publish', '发布', '公開')}</button></div>)}</section><section className="desktop-card desktop-render-card"><div className="desktop-card-title"><span>02</span><div><b>{t('최종 파일', 'Final render', '最终文件', '最終ファイル')}</b><small>{relativeWorkspacePath(project.output_path)}</small></div></div><div className={`desktop-render-state ${outputReady ? 'ready' : ''}`}><span>{outputReady ? '✓' : '○'}</span><div><b>{outputReady ? t('렌더 파일 준비됨', 'Render ready', '渲染文件已就绪', 'レンダー準備完了') : t('아직 렌더되지 않음', 'Not rendered yet', '尚未渲染', '未レンダー')}</b><small>{timeline.settings.quality} · {timeline.settings.fps}fps</small></div></div><button className="desktop-primary" disabled={busy} onClick={() => void runLocalRender()}>{t('지금 로컬 렌더', 'Render locally now', '立即本地渲染', '今すぐローカルレンダー')}</button><button className="desktop-secondary" disabled={busy} onClick={() => void enqueueQueuedRender()}>{t('대기열에 넣기', 'Add to queue', '加入队列', 'キューに追加')}</button>{queueJobs.length ? <small>{queueJobs.length} {t('개 대기', 'queued', '个排队', '件待機')}</small> : null}</section><section className="desktop-card"><div className="desktop-card-title"><span>03</span><div><b>{t('교환 파일', 'Exchange', '交换文件', '交換')}</b><small>EDL · OTIO</small></div></div><div className="desktop-relay-actions"><button onClick={() => void exportExchange('edl')}>EDL</button><button onClick={() => void exportExchange('otio')}>OTIO</button></div>{exchangeText ? <textarea className="desktop-exchange" readOnly value={exchangeText} /> : null}</section><section className="desktop-card desktop-receipts-card"><div className="desktop-card-title"><span>04</span><div><b>{t('게시 영수증', 'Publish receipts', '发布回执', '公開レシート')}</b><small>{t('실패와 중단된 게시는 재시도할 수 있습니다. 중단 후 재시도는 플랫폼에 한 번 더 올라갈 수 있습니다.', 'Failed or interrupted publishes can be retried. Retrying an interrupted upload may create a second copy.', '失败或中断的发布可以重试。中断后重试可能在平台上再上传一份。', '失敗と中断した公開は再試行できます。中断後の再試行はもう1本増えることがあります。')}</small></div></div>{confirmReceipt && confirmReceipt.project_id === selectedProjectId ? <div className="desktop-receipt-confirm" role="alertdialog" aria-labelledby="receipt-confirm-title"><b id="receipt-confirm-title">{t('중단된 게시', 'Interrupted publish', '已中断的发布', '中断された公開')}</b><p>{t('플랫폼이 이미 첫 업로드를 받았다면 영상이 하나 더 올라갈 수 있습니다. 그래도 다시 올리겠습니까?', 'If the platform already accepted the first upload, a second copy may appear. Retry anyway?', '如果平台已接受第一次上传，可能会再出现一份。仍要重试吗？', '最初のアップロードが受理済みなら、もう1本増えることがあります。それでも再試行しますか？')}</p><div><button type="button" disabled={busy} onClick={() => void retryReceipt(confirmReceipt, true)}>{t('그래도 재시도', 'Retry anyway', '仍要重试', 'それでも再試行')}</button><button type="button" className="desktop-secondary" disabled={busy} onClick={() => setConfirmReceipt(null)}>{t('취소', 'Cancel', '取消', 'キャンセル')}</button></div></div> : null}{visibleReceipts.length ? visibleReceipts.map((receipt) => <div className={`desktop-receipt ${receipt.status}`} key={receipt.id}><div><b>{receipt.platform} · {receipt.status}</b><small>{receipt.error_text || receipt.idempotency_key}</small></div><button disabled={busy || (receipt.status !== 'failed' && receipt.status !== 'interrupted')} onClick={() => void retryReceipt(receipt)}>{receipt.status === 'interrupted' ? t('중복 확인', 'Confirm retry', '确认重试', '重複を確認') : t('재시도', 'Retry', '重试', '再試行')}</button></div>) : <div className="desktop-receipt-empty"><b>{t('아직 게시 영수증이 없습니다', 'No publish receipts yet', '暂无发布回执', '公開レシートはまだありません')}</b><p>{outputReady ? t('위에서 플랫폼을 고른 뒤 게시하면 성공·실패가 여기에 남습니다.', 'Publish a platform above to keep success and failure here.', '在上方选择平台并发布后，成功和失败会记录在这里。', '上でプラットフォームを選んで公開すると、成功と失敗がここに残ります。') : t('먼저 로컬 렌더를 만든 다음 Instagram, TikTok, YouTube에 게시하세요.', 'Render locally first, then publish to Instagram, TikTok, or YouTube.', '请先完成本地渲染，再发布到 Instagram、TikTok 或 YouTube。', '先にローカルレンダーを作り、Instagram・TikTok・YouTube に公開してください。')}</p></div>}</section></div>}
          </>}
        </section>

        <aside className={`desktop-inspector ${drawer === 'status' ? 'open' : ''}`}>
          <section className="desktop-inspector-section">
            <div className="desktop-inspector-head"><b>{t('Grok 상태', 'Grok status', 'Grok 状态', 'Grok 状態')}</b><span className={`desktop-status-dot ${statusTone(latestJob?.status ?? 'waiting')}`} /></div>
            <div className="desktop-agent-card"><span className="desktop-agent-avatar">G</span><div><b>{runner?.display_name ?? 'Grok Runner'}</b><small>{latestEvent ? `${t('원격', 'Remote', '远程', 'リモート')}: ${latestEvent.stage.replaceAll('_', ' ')}` : t('원격 확인 대기', 'Awaiting verified remote activity', '等待远程确认', 'リモート確認待ち')}</small></div></div>
            {latestJob && <div className="desktop-local-state"><span>{t('로컬 앱', 'Local app', '本地应用', 'ローカルアプリ')}</span><b>{latestJob.status.replaceAll('_', ' ')}</b><small>attempt {latestJob.attempt ?? 1}{latestJob.render_job_id ? ` · render ${latestJob.render_job_id.slice(0, 8)}` : ''}</small></div>}
            {latestEvent ? <div className="desktop-verified"><b>{latestEvent.status}</b><span>{t('마지막 확인', 'Last verified', '最后确认', '最終確認')} {new Date(latestEvent.verified_at).toLocaleString()}</span></div> : <p className="desktop-muted">{t('확인된 원격 활동이 아직 없습니다. 상태를 추측하지 않습니다.', 'No verified remote activity yet. Presence is never guessed.', '暂无已确认的远程活动。', '確認済みのリモート活動はまだありません。')}</p>}
            {inputRequest && <div className="desktop-input-request"><b>{inputRequest.question}</b>{inputRequest.options.map((option) => <button key={option.value} disabled={busy} onClick={() => void answerRunnerInput(option.value)}><span>{option.label}</span>{option.description && <small>{option.description}</small>}</button>)}</div>}
            {latestJob?.status === 'conflict' && latestJob.conflict_json && <div className="desktop-conflict-card"><b>{t('타임라인 충돌 검토', 'Timeline conflict review', '时间线冲突审核', 'タイムライン競合レビュー')}</b><p>{t(`Grok 기준 v${latestJob.conflict_json.expected_revision}, 현재 v${latestJob.conflict_json.current_revision}`, `Grok used v${latestJob.conflict_json.expected_revision}; current timeline is v${latestJob.conflict_json.current_revision}.`, `Grok 基于 v${latestJob.conflict_json.expected_revision}，当前为 v${latestJob.conflict_json.current_revision}`, `Grok は v${latestJob.conflict_json.expected_revision}、現在は v${latestJob.conflict_json.current_revision} です。`)}</p><small>{latestJob.conflict_json.reason}</small><div><button disabled={busy} onClick={() => void resolveConflict('retry_current')}>{t('현재 버전으로 다시 요청', 'Retry current revision', '基于当前版本重试', '現在版で再試行')}</button><button disabled={busy} onClick={() => void resolveConflict('discard')}>{t('편집안 폐기', 'Discard proposal', '放弃方案', '提案を破棄')}</button></div></div>}
            <div className="desktop-github-card"><div><b>GitHub</b><span className={github.authenticated ? 'ok' : ''}>{github.authenticated ? `✓ ${github.login}` : t('로그인 필요', 'Login required', '需要登录', 'ログインが必要')}</span></div><small>{github.relay_connected ? github.remote : t('비공개 relay 저장소가 연결되지 않았습니다.', 'No private relay repository connected.', '尚未连接私有 relay 仓库。', '非公開 relay リポジトリ未接続。')}</small>{!github.authenticated && <><button disabled={busy || !github.oauth_available} onClick={() => void loginGitHub('device')}>{t('브라우저로 GitHub 로그인', 'GitHub browser login', '通过浏览器登录 GitHub', 'ブラウザで GitHub ログイン')}</button><div className="desktop-token-login"><input type="password" autoComplete="off" value={githubToken} onChange={(event) => setGithubToken(event.target.value)} placeholder={t('또는 GitHub 토큰', 'Or GitHub token', '或 GitHub 令牌', 'または GitHub トークン')} /><button disabled={busy || githubToken.length < 20} onClick={() => void loginGitHub('token')}>{t('토큰 연결', 'Connect token', '连接令牌', 'トークン接続')}</button></div></>}</div>
            <div className="desktop-relay-actions"><button onClick={() => void relayAction('pair')}>{t('Runner 페어링', 'Pair Runner', '配对 Runner', 'Runner ペアリング')}</button><button onClick={() => void relayAction('desktop')}>{t('데스크톱 키 내보내기', 'Export desktop key', '导出桌面密钥', 'デスクトップ鍵を書き出す')}</button><button onClick={() => void relayAction('git-connect')}>{github.relay_connected ? t('relay 저장소 변경', 'Change relay repo', '更改 relay 仓库', 'relay を変更') : t('GitHub relay 연결', 'Connect GitHub relay', '连接 GitHub relay', 'GitHub relay 接続')}</button>{latestJob && <button onClick={() => void relayAction('git-push')}>{t('작업 다시 전송', 'Resend job', '重新发送任务', 'ジョブ再送信')}</button>}<button onClick={() => void relayAction('git-pull')}>{t('지금 동기화', 'Sync now', '立即同步', '今すぐ同期')}</button><button onClick={() => void relayAction('request')}>{t('오프라인 요청 내보내기', 'Export offline request', '导出离线请求', 'オフライン要求を書き出す')}</button><button onClick={() => void relayAction('result')}>{t('오프라인 결과 가져오기', 'Import offline result', '导入离线结果', 'オフライン結果を読み込む')}</button></div>
            {latestJob && !['completed', 'cancelled', 'failed', 'conflict', 'paused', 'pause_requested'].includes(latestJob.status) && <div className="desktop-control-actions"><button disabled={busy} onClick={() => void controlRunnerJob('pause')}>{t('일시정지', 'Pause', '暂停', '一時停止')}</button><button className="desktop-danger" disabled={busy} onClick={() => void controlRunnerJob('cancel')}>{t('작업 취소', 'Cancel job', '取消任务', 'ジョブをキャンセル')}</button></div>}
            {latestJob && ['paused', 'pause_requested'].includes(latestJob.status) && <div className="desktop-control-actions"><button disabled={busy} onClick={() => void controlRunnerJob('resume')}>{t('같은 세션 재개', 'Resume session', '恢复会话', 'セッション再開')}</button><button className="desktop-danger" disabled={busy} onClick={() => void controlRunnerJob('cancel')}>{t('작업 취소', 'Cancel job', '取消任务', 'ジョブをキャンセル')}</button></div>}
            {latestJob && ['failed', 'cancelled'].includes(latestJob.status) && <button className="desktop-secondary" disabled={busy} onClick={() => void controlRunnerJob('retry')}>{t('안전하게 재시도', 'Safe retry', '安全重试', '安全に再試行')}</button>}
          </section>
          <section className="desktop-inspector-section desktop-elements">
            <div className="desktop-inspector-head"><b>{t('편집 요소', 'Edit elements', '编辑元素', '編集要素')}</b></div>
            <label><span>B-roll</span>
              <select value={newElement.brollPath} onChange={(event) => setNewElement({ ...newElement, brollPath: event.target.value })}>
                <option value="">{t('영상 선택', 'Choose video', '选择视频', '動画を選択')}</option>
                {workspace.media.filter((item) => item.kind === 'video' && item.area === 'inputs').map((item) => <option key={item.path} value={item.path}>{item.name}</option>)}
              </select>
              <button disabled={!newElement.brollPath} onClick={() => void addTimelineElement('broll')}>{t('추가', 'Add', '添加', '追加')}</button>
            </label>
            <label><span>{t('타이틀', 'Title', '标题', 'タイトル')}</span>
              <input value={newElement.title} onChange={(event) => setNewElement({ ...newElement, title: event.target.value })} />
              <button disabled={!newElement.title.trim()} onClick={() => void addTimelineElement('title')}>{t('추가', 'Add', '添加', '追加')}</button>
            </label>
            <label><span>{t('자막', 'Caption', '字幕', '字幕')}</span>
              <input value={newElement.caption} onChange={(event) => setNewElement({ ...newElement, caption: event.target.value })} />
              <button disabled={!newElement.caption.trim()} onClick={() => void addTimelineElement('caption')}>{t('추가', 'Add', '添加', '追加')}</button>
            </label>
          </section>
          {timeline ? (
            <AudioMixer
              timeline={timeline}
              disabled={busy || timelineEditing.pending}
              onUpdate={(track, changes) => {
                void patchTimeline([
                  { op: 'update_track', track_id: track.id, changes },
                ], t('오디오 믹서를 새 버전에 적용했습니다.', 'Applied the audio mix in a new version.', '已在新版本中应用音频混音。', 'オーディオミックスを新しいバージョンに適用しました。'));
              }}
            />
          ) : null}
          {selected ? (
            <section className="desktop-inspector-section">
              <ClipLookPanel
                track={selected.track}
                clip={selected.clip}
                onChange={(changes) => void updateSelectedClip(changes)}
              />
            </section>
          ) : null}
          <section className="desktop-inspector-section"><div className="desktop-inspector-head"><b>{t('클립 속성', 'Clip inspector', '片段属性', 'クリップ属性')}</b>{selectedClipIds.length > 1 ? <span>{selectedClipIds.length} {t('개 선택', 'selected', '个已选', '件選択')}</span> : null}</div>{selected ? <div className="desktop-clip-form"><label>ID<input value={selected.clip.id} disabled /></label><label>{t('시작', 'Start', '开始', '開始')}<input type="number" min="0" step=".1" value={selected.clip.timeline_start} onChange={(e) => void updateSelectedClip({ timeline_start: Number(e.target.value) })} /></label><label>{t('길이', 'Duration', '时长', '長さ')}<input type="number" min=".1" step=".1" value={selected.clip.duration} onChange={(e) => void updateSelectedClip({ duration: Number(e.target.value) })} /></label>{['video', 'overlay'].includes(selected.track.type) && <><label>{t('크기', 'Scale', '缩放', 'スケール')}<input type="number" min=".05" max="8" step=".05" value={selected.clip.transform?.scale ?? 1} onChange={(e) => void updateSelectedClip({ transform: { ...(selected.clip.transform ?? {}), scale: Number(e.target.value) } })} /></label><label>{t('회전', 'Rotation', '旋转', '回転')}<input type="number" min="-360" max="360" step="1" value={selected.clip.transform?.rotation ?? 0} onChange={(e) => void updateSelectedClip({ transform: { ...(selected.clip.transform ?? {}), rotation: Number(e.target.value) } })} /></label><label>{t('불투명도', 'Opacity', '不透明度', '不透明度')}<input type="number" min="0" max="1" step=".05" value={selected.clip.transform?.opacity ?? 1} onChange={(e) => void updateSelectedClip({ transform: { ...(selected.clip.transform ?? {}), opacity: Number(e.target.value) } })} /></label></>}{['video', 'audio'].includes(selected.track.type) && <label>{t('볼륨', 'Volume', '音量', '音量')}<input type="number" min="0" max="4" step=".05" value={Number(selected.clip.audio?.volume ?? 1)} onChange={(e) => void updateSelectedClip({ audio: { ...(selected.clip.audio ?? {}), volume: Number(e.target.value) } })} /></label>}{selected.track.type === 'caption' && <label>{t('자막 문구', 'Caption text', '字幕文本', '字幕テキスト')}<textarea value={selected.clip.text ?? ''} onChange={(e) => void updateSelectedClip({ text: e.target.value })} /></label>}{['video', 'overlay', 'caption'].includes(selected.track.type) && <><label>{t('시작 전환', 'Transition in', '入场转场', '開始トランジション')}<select value={selected.clip.transition_in?.type ?? ''} onChange={(e) => void updateSelectedClip({ transition_in: e.target.value ? { type: e.target.value, duration: selected.clip.transition_in?.duration ?? 0.35 } : null })}><option value="">{t('없음', 'None', '无', 'なし')}</option><option value="fade">Fade</option><option value="crossfade">Crossfade</option><option value="dip_black">Dip black</option></select></label><label>{t('끝 전환', 'Transition out', '出场转场', '終了トランジション')}<select value={selected.clip.transition_out?.type ?? ''} onChange={(e) => void updateSelectedClip({ transition_out: e.target.value ? { type: e.target.value, duration: selected.clip.transition_out?.duration ?? 0.35 } : null })}><option value="">{t('없음', 'None', '无', 'なし')}</option><option value="fade">Fade</option><option value="crossfade">Crossfade</option><option value="dip_black">Dip black</option></select></label><label>{t('전환 길이', 'Transition duration', '转场时长', 'トランジション時間')}<input type="number" min=".05" max={Math.min(5, selected.clip.duration)} step=".05" value={selected.clip.transition_in?.duration ?? selected.clip.transition_out?.duration ?? .35} onChange={(e) => { const duration = Number(e.target.value); void updateSelectedClip({ ...(selected.clip.transition_in ? { transition_in: { ...selected.clip.transition_in, duration } } : {}), ...(selected.clip.transition_out ? { transition_out: { ...selected.clip.transition_out, duration } } : {}) }); }} /></label></>}{<label className="desktop-check"><input type="checkbox" checked={selected.clip.locked} onChange={(e) => void updateSelectedClip({ locked: e.target.checked })} />{t('클립 잠금', 'Lock clip', '锁定片段', 'クリップをロック')}</label>}<div className="desktop-clip-actions"><button onClick={() => void splitSelected()}>{t('중간 분할', 'Split', '分割', '分割')}</button><button className="danger" onClick={() => void removeSelected()}>{t('삭제', 'Delete', '删除', '削除')}</button></div></div> : <p className="desktop-muted">{t('타임라인에서 클립을 선택하세요.', 'Select a clip in the timeline.', '在时间线上选择片段。', 'タイムラインでクリップを選択してください。')}</p>}</section>
        </aside>
      </div>

      {project && timeline && (
        <TimelineEditor
          timeline={timeline}
          selectedClipIds={selectedClipIds}
          onSelectClips={setSelectedClipIds}
          editing={timelineEditing}
          history={history}
          onHistoryAction={(action) => void runTimelineHistoryAction(action)}
          onAddTrack={(type) => void addTrack(type)}
          trackBusy={busy || timelineEditing.pending}
          onPlayheadChange={setPlayhead}
        />
      )}

      <footer className="desktop-command-bar"><div className={`desktop-message ${studioState === 'error' ? 'error' : studioState === 'loading' ? 'loading' : ''}`}><span className="desktop-message-icon">{studioState === 'error' ? '!' : studioState === 'loading' ? '…' : 'i'}</span><p>{message}</p></div><div className="desktop-command-summary"><span>{executionPolicy === 'auto_edit_render' ? t('자동 편집·렌더', 'Auto edit & render', '自动编辑和渲染', '自動編集・レンダー') : t('검토 우선', 'Review first', '审核优先', '確認優先')}</span><span>{Object.values(publishPolicy).filter((value) => value === 'auto').length} {t('개 자동 게시', 'auto publish', '个自动发布', '件の自動公開')}</span><button className="desktop-start" disabled={busy || !project || studioState !== 'ready'} onClick={() => void startGrok()}>{busy ? t('처리 중…', 'Working…', '处理中…', '処理中…') : t('Grok으로 제작 시작', 'Start with Grok', '使用 Grok 开始制作', 'Grokで制作開始')} <b>→</b></button></div></footer>
    </main>
  );
}
