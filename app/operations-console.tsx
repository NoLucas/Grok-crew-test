'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLanguage } from './language';
import { SiteHeader } from './site-header';

type Project = { id: string; title: string; source_path: string; output_path: string; caption: string; timeline_json: { clips?: Array<{ start?: number; end?: number }> } };
type Job = { id: string; kind: string; status: string; error_text?: string | null };
type Artifact = { id: string; project_id: string | null; type: string; title: string; payload: Record<string, unknown>; created_by: string; created_at: string; updated_at: string };
type Operations = { project: Project; jobs: Job[]; artifacts: Artifact[]; failed_jobs: Job[] };
type Health = { status: string; bind: string; moviepy_installed: boolean };

const studio = 'http://127.0.0.1:7214';
const starterTranscript = JSON.stringify([
  { start: 0.0, end: 1.4, text: 'This is the payoff.' },
  { start: 1.9, end: 2.2, text: 'um' },
  { start: 2.8, end: 5.1, text: 'Here is the proof.' },
], null, 2);

function stamp(value?: string) { return value ? new Date(value).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }
function text(value: unknown) { return typeof value === 'string' ? value : ''; }

export default function OperationsConsole() {
  const { t } = useLanguage();
  const [health, setHealth] = useState<Health | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState('');
  const [operations, setOperations] = useState<Operations | null>(null);
  const [brandKits, setBrandKits] = useState<Artifact[]>([]);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('로컬 운영 센터를 준비하고 있습니다.');
  const [transcript, setTranscript] = useState(starterTranscript);
  const [strategy, setStrategy] = useState('첫 1.5초에 결과를 보여 주고, 대본 기준으로 군더더기를 제거합니다.');
  const [decisions, setDecisions] = useState('');
  const [outstanding, setOutstanding] = useState('사람 승인 전에는 렌더하지 않습니다.');
  const [taskTitle, setTaskTitle] = useState('대본 기준 컷 검토');
  const [taskDetail, setTaskDetail] = useState('침묵 구간과 filler 제안을 확인하고 EDL을 준비합니다.');
  const [botId, setBotId] = useState('local-editor-bot');
  const [audioPlan, setAudioPlan] = useState('무음 0.5초 이상 검토 · 컷 경계 30ms 페이드 · 필요 시 음량 표준화');
  const [variantName, setVariantName] = useState('A안 · payoff first');
  const [overlayPlan, setOverlayPlan] = useState('0:00–0:02 · 제목 카드 · safe zone 상단');
  const [kitName, setKitName] = useState('기본 브랜드 키트');
  const [kitStyle, setKitStyle] = useState('노란 강조 · 굵은 자막 · 하단 안전 영역 · natural look');
  const [performanceNote, setPerformanceNote] = useState('게시 후 조회수·저장·댓글·반응이 좋은 훅을 기록합니다.');
  const [bundleFile, setBundleFile] = useState<File | null>(null);

  const api = useCallback(async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (init.body) headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(`${studio}${path}`, { ...init, headers });
    const value = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(text(value.error) || '로컬 서비스 요청에 실패했습니다.');
    return value;
  }, [token]);

  const loadOperations = useCallback(async (projectId: string, quiet = false) => {
    if (!projectId) { setOperations(null); return; }
    try {
      const value = await api(`/api/projects/${projectId}/operations`);
      setOperations(value as unknown as Operations);
      if (!quiet) setMessage('선택한 프로젝트의 로컬 편집 운영 기록을 불러왔습니다.');
    } catch (error) { setOperations(null); if (!quiet) setMessage(error instanceof Error ? error.message : '프로젝트 운영 기록을 읽지 못했습니다.'); }
  }, [api]);

  const refresh = useCallback(async (quiet = false) => {
    try {
      const [nextHealth, nextProjects, nextKits] = await Promise.all([api('/health'), api('/api/projects'), api('/api/brand-kits')]);
      const list = (nextProjects.projects ?? []) as Project[];
      setHealth(nextHealth as unknown as Health); setProjects(list); setBrandKits((nextKits.brand_kits ?? []) as Artifact[]);
      setSelected((current) => current || list[0]?.id || '');
      if (!quiet) setMessage(list.length ? '로컬 프로젝트를 선택해 P0–P2 운영 기능을 사용할 수 있습니다.' : '먼저 Production에서 로컬 프로젝트를 만든 뒤 운영 기능을 사용하세요.');
    } catch (error) { setHealth(null); setProjects([]); setBrandKits([]); setMessage(error instanceof Error ? `${error.message} — Local Studio를 먼저 실행하세요.` : 'Local Studio에 연결할 수 없습니다.'); }
  }, [api]);

  useEffect(() => { const timeout = window.setTimeout(() => { void refresh(); }, 0); return () => window.clearTimeout(timeout); }, [refresh]);
  useEffect(() => { if (!selected) return; const timeout = window.setTimeout(() => { void loadOperations(selected, true); }, 0); return () => window.clearTimeout(timeout); }, [selected, loadOperations]);

  const action = async (label: string, path: string, body: Record<string, unknown>) => {
    if (!selected && path.includes('/projects/')) { setMessage('먼저 프로젝트를 선택하세요.'); return; }
    setBusy(true);
    try {
      await api(path, { method: 'POST', body: JSON.stringify(body) });
      await refresh(true); await loadOperations(selected, true);
      setMessage(`${label}을(를) 로컬 기록에 저장했습니다.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : `${label}을(를) 저장하지 못했습니다.`); }
    finally { setBusy(false); }
  };

  const artifacts = useMemo(() => operations?.artifacts ?? [], [operations]);
  const byType = useCallback((type: string) => artifacts.filter((artifact) => artifact.type === type), [artifacts]);
  const latest = useCallback((type: string) => byType(type)[0], [byType]);
  const clipCount = operations?.project.timeline_json.clips?.length ?? 0;
  const latestCutMap = latest('cut_map'); const latestQa = latest('quality_report') ?? latest('preflight_report'); const latestInspection = latest('media_inspection');
  const qualityPassed = latestQa?.payload.passed === true;
  const tasks = byType('bot_task'); const memories = byType('project_memory'); const variants = byType('edit_variant'); const overlays = byType('overlay_slots'); const performance = byType('performance_note');
  const selectedProject = useMemo(() => projects.find((project) => project.id === selected), [projects, selected]);

  const exportBundle = async () => {
    if (!selected) { setMessage('먼저 프로젝트를 선택하세요.'); return; }
    setBusy(true);
    try {
      const response = await api(`/api/projects/${selected}/export`);
      const bundle = response.bundle ?? response;
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${selectedProject?.title || 'project'}-bundle.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage('프로젝트 번들을 내보냈습니다. 원본 미디어 파일은 포함되지 않습니다.');
    } catch (error) { setMessage(error instanceof Error ? error.message : '번들을 내보내지 못했습니다.'); }
    finally { setBusy(false); }
  };
  const importBundle = async () => {
    if (!bundleFile) { setMessage('가져올 번들 파일을 먼저 선택하세요.'); return; }
    setBusy(true);
    try {
      const fileText = await bundleFile.text();
      const bundle = JSON.parse(fileText) as unknown;
      await api('/api/projects/import', { method: 'POST', body: JSON.stringify({ bundle }) });
      await refresh(true);
      setBundleFile(null);
      setMessage('번들을 새 로컬 프로젝트로 가져왔습니다.');
    } catch (error) { setMessage(error instanceof Error ? error.message : '번들을 가져오지 못했습니다.'); }
    finally { setBusy(false); }
  };

  const submitCutMap = () => {
    try {
      const segments = JSON.parse(transcript) as unknown;
      if (!Array.isArray(segments)) throw new Error('대본은 배열 형식의 JSON이어야 합니다.');
      void action('대본 컷 맵', `/api/projects/${selected}/cut-map`, { title: '대본·단어 단위 컷 맵', segments, created_by: botId });
    } catch (error) { setMessage(error instanceof Error ? error.message : '대본 형식을 확인하세요.'); }
  };

  return <>
    <SiteHeader current="operations" />
    <main className="ops-main">
      <section className="ops-hero"><div><p className="kicker">LOCAL EDIT OPERATIONS</p><h1>{t('봇의 편집을', 'Turn bot editing into', '把机器人的剪辑', 'ボットの編集を')}<br /><span>{t('검사 가능한 제작 흐름으로.', 'a verifiable production flow.', '变成可核查的制作流程。', '検証可能な制作フローに。')}</span></h1><p>{t('대본 컷 맵, 미디어 검사, 품질 보고, 프로젝트 기억, 봇 작업 보드를 하나의 로컬 운영 화면에서 관리합니다. 모든 기록은 이 PC의 SQLite에만 저장됩니다.', 'Manage transcript cut maps, media checks, quality reports, project memory, and bot work in one local operations surface. Every record stays in SQLite on this PC.', '在一个本地运营界面中管理文字稿剪辑图、素材检查、质量报告、项目记忆和机器人任务。所有记录都只保存在这台电脑的 SQLite 中。', '文字起こしカットマップ、素材チェック、品質レポート、プロジェクト記憶、ボット作業ボードを、ひとつのローカル運営画面で管理します。すべての記録はこの PC の SQLite にのみ保存されます。')}</p></div><aside className={`ops-health ${health ? 'ready' : ''}`}><span>LOCAL STUDIO</span><b>{health ? 'READY FOR OPS' : 'OFFLINE'}</b><p>{health ? `${projects.length} project(s) · ${health.moviepy_installed ? 'MoviePy ready' : 'render setup needed'}` : 'Start Local Studio to use the operations center.'}</p><button onClick={() => void refresh()} disabled={busy}>운영 상태 새로고침</button></aside></section>
      <section className="ops-project-bar"><div><span>ACTIVE PROJECT</span><select value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">프로젝트 선택</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.title}</option>)}</select></div><p>{selectedProject ? <><b>{selectedProject.source_path}</b> → <b>{selectedProject.output_path}</b> · {clipCount}개 EDL 컷</> : 'Production 페이지에서 프로젝트를 만들면 대본·검사·봇 협업 기록을 이곳에 연결할 수 있습니다.'}</p><label>로컬 보호 토큰<input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="필요한 경우 이 탭에서만 입력" /></label></section>
      <section className="ops-message"><b>운영 상태</b><span>{message}</span></section>

      <section className="ops-section"><div className="ops-section-head"><div><p className="kicker">P0 · CORE WORKFLOW</p><h2>봇이 판단하고, <span>사람이 확인하는</span> 편집 기반.</h2></div><p>모든 제안은 비파괴적 기록입니다. 품질 보고나 봇 작업은 렌더·게시 승인으로 이어지지 않습니다.</p></div><div className="ops-grid p0-grid">
        <article className="ops-card inspect-card"><div className="ops-card-head"><span>01 · MEDIA INSPECTION</span><em>{latestInspection ? stamp(latestInspection.created_at) : 'not run'}</em></div><h3>미디어 사전 검사</h3><p>로컬 파일의 해상도, FPS, 코덱, 오디오, 무음·검은 화면 구간을 검사합니다.</p><button onClick={() => void action('미디어 사전 검사', `/api/projects/${selected}/inspect`, { created_by: botId })} disabled={busy || !selected}>원본 파일 검사</button>{latestInspection ? <dl className="ops-facts"><div><dt>해상도</dt><dd>{String(latestInspection.payload.width ?? '—')} × {String(latestInspection.payload.height ?? '—')}</dd></div><div><dt>FPS</dt><dd>{String(latestInspection.payload.fps ?? '—')}</dd></div><div><dt>무음 구간</dt><dd>{Array.isArray(latestInspection.payload.silence_ranges) ? latestInspection.payload.silence_ranges.length : 0}</dd></div></dl> : <small>검사 결과는 프로젝트별로 저장됩니다.</small>}</article>
        <article className="ops-card cutmap-card"><div className="ops-card-head"><span>02 · TRANSCRIPT CUT MAP</span><em>{latestCutMap ? `${Array.isArray(latestCutMap.payload.segments) ? latestCutMap.payload.segments.length : 0} entries` : 'awaiting transcript'}</em></div><h3>대본·단어 단위 컷 맵</h3><p>Grok bot이 만든 시간 표시 대본을 넣으면 filler와 0.4초 이상 침묵을 컷 후보로 제안합니다.</p><textarea value={transcript} onChange={(event) => setTranscript(event.target.value)} aria-label="Timestamped transcript JSON" /><button onClick={submitCutMap} disabled={busy || !selected}>컷 제안 만들기</button>{latestCutMap ? <small>{Array.isArray(latestCutMap.payload.suggestions) ? latestCutMap.payload.suggestions.length : 0}개 검토 제안 · 원본 EDL은 자동 변경되지 않습니다.</small> : null}</article>
        <article className="ops-card qa-card"><div className="ops-card-head"><span>03 · RENDER QA</span><em className={qualityPassed ? 'good' : ''}>{latestQa ? qualityPassed ? 'PASSED' : 'REVIEW' : 'not run'}</em></div><h3>렌더 전후 품질 검사</h3><p>소스·EDL 구간·길이·자막·출력 형식·완성 파일·게시 캡션을 단계별로 확인합니다.</p><div className="ops-button-row"><button onClick={() => void action('렌더 전 품질 검사', `/api/projects/${selected}/quality-check`, { stage: 'pre_render', created_by: botId })} disabled={busy || !selected}>렌더 전 검사</button><button onClick={() => void action('게시 전 검사', `/api/projects/${selected}/quality-check`, { stage: 'publish', created_by: botId })} disabled={busy || !selected}>게시 전 검사</button></div><small>{latestQa ? `${Array.isArray(latestQa.payload.checks) ? latestQa.payload.checks.length : 0}개 항목 · ${text(latestQa.payload.stage)}` : '검사는 문제를 알릴 뿐, 승인이나 렌더를 시작하지 않습니다.'}</small></article>
        <article className="ops-card memory-card"><div className="ops-card-head"><span>04 · PROJECT MEMORY</span><em>{memories.length} saved</em></div><h3>프로젝트 기억장</h3><label>편집 전략<textarea value={strategy} onChange={(event) => setStrategy(event.target.value)} /></label><label>결정 이유<textarea value={decisions} onChange={(event) => setDecisions(event.target.value)} placeholder="왜 이 컷과 룩을 선택했는지" /></label><label>남은 확인 사항<textarea value={outstanding} onChange={(event) => setOutstanding(event.target.value)} /></label><button onClick={() => void action('프로젝트 기억', `/api/projects/${selected}/artifacts`, { type: 'project_memory', title: '편집 전략 기록', payload: { strategy, decisions, outstanding }, created_by: botId })} disabled={busy || !selected}>기억 저장</button></article>
        <article className="ops-card task-card"><div className="ops-card-head"><span>05 · BOT TASK BOARD</span><em>{tasks.length} task(s)</em></div><h3>봇 작업 보드</h3><input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} aria-label="Task title" /><textarea value={taskDetail} onChange={(event) => setTaskDetail(event.target.value)} aria-label="Task details" /><div className="ops-task-controls"><input value={botId} onChange={(event) => setBotId(event.target.value)} aria-label="Bot id" /><button onClick={() => void action('봇 작업', `/api/projects/${selected}/artifacts`, { type: 'bot_task', title: taskTitle, payload: { detail: taskDetail, status: 'ready', owner_bot_id: '', approval_required: false }, created_by: botId })} disabled={busy || !selected}>작업 추가</button></div><div className="ops-task-list">{tasks.length ? tasks.slice(0, 5).map((task) => <article key={task.id}><b>{task.title}</b><span>{text(task.payload.status) || 'ready'} · {text(task.payload.owner_bot_id) || 'unassigned'}</span><div><button onClick={() => void action('작업 점유', `/api/artifacts/${task.id}/update`, { payload: { status: 'claimed', owner_bot_id: botId } })} disabled={busy}>점유</button><button onClick={() => void action('작업 완료', `/api/artifacts/${task.id}/update`, { payload: { status: 'done', owner_bot_id: botId } })} disabled={busy}>완료</button></div></article>) : <small>Grok bot별 작업을 만들고 점유·완료 상태를 남기세요.</small>}</div></article>
      </div></section>

      <section className="ops-section"><div className="ops-section-head"><div><p className="kicker">P1 · FINISH AND PUBLISH</p><h2>더 빠르게 비교하고, <span>같은 톤으로 마무리.</span></h2></div><p>이 설정은 로컬 프로젝트에 저장되어 bot과 사람이 같은 기준으로 다음 편집을 이어갑니다.</p></div><div className="ops-grid p1-grid">
        <article className="ops-card"><div className="ops-card-head"><span>06 · AUDIO PLAN</span><em>{byType('audio_plan').length} saved</em></div><h3>오디오 정리 패널</h3><textarea value={audioPlan} onChange={(event) => setAudioPlan(event.target.value)} /><button onClick={() => void action('오디오 계획', `/api/projects/${selected}/artifacts`, { type: 'audio_plan', title: '오디오 정리 계획', payload: { plan: audioPlan, target: 'local render settings' }, created_by: botId })} disabled={busy || !selected}>오디오 계획 저장</button><small>무음 검사 결과와 컷 페이드 규칙을 함께 기록합니다.</small></article>
        <article className="ops-card"><div className="ops-card-head"><span>07 · A/B EDIT COMPARE</span><em>{variants.length} version(s)</em></div><h3>A/B 편집 비교</h3><input value={variantName} onChange={(event) => setVariantName(event.target.value)} aria-label="Variant name" /><button onClick={() => void action('편집안', `/api/projects/${selected}/artifacts`, { type: 'edit_variant', title: variantName, payload: { cut_count: clipCount, hook: 'review in cut map', source_project: selected }, created_by: botId })} disabled={busy || !selected}>현재 안 저장</button><div className="ops-mini-list">{variants.length ? variants.slice(0, 3).map((variant) => <span key={variant.id}>{variant.title} · {String(variant.payload.cut_count ?? '—')} cuts</span>) : <small>두 가지 편집안을 저장해 길이·훅·컷 수를 비교하세요.</small>}</div></article>
        <article className="ops-card"><div className="ops-card-head"><span>08 · BRAND KIT</span><em>{brandKits.length} kit(s)</em></div><h3>브랜드 키트</h3><input value={kitName} onChange={(event) => setKitName(event.target.value)} aria-label="Brand kit name" /><textarea value={kitStyle} onChange={(event) => setKitStyle(event.target.value)} /><button onClick={() => void action('브랜드 키트', '/api/brand-kits', { name: kitName, payload: { style: kitStyle, caption_safe_zone: 'bottom', look: 'natural' }, created_by: botId })} disabled={busy}>브랜드 키트 저장</button><div className="ops-mini-list">{brandKits.length ? brandKits.slice(0, 3).map((kit) => <span key={kit.id}>{kit.title}</span>) : <small>자막·안전 영역·룩을 팀의 기본값으로 저장하세요.</small>}</div></article>
        <article className="ops-card"><div className="ops-card-head"><span>09 · OVERLAY SLOTS</span><em>{overlays.length} plan(s)</em></div><h3>오버레이 슬롯</h3><textarea value={overlayPlan} onChange={(event) => setOverlayPlan(event.target.value)} /><button onClick={() => void action('오버레이 계획', `/api/projects/${selected}/artifacts`, { type: 'overlay_slots', title: '오버레이 슬롯 계획', payload: { slots: overlayPlan, caption_layer: 'always_last' }, created_by: botId })} disabled={busy || !selected}>슬롯 저장</button><small>CTA·진행 바·제목 카드·강조 그래픽을 시간 축 기준으로 계획합니다.</small></article>
        <article className="ops-card publish-card"><div className="ops-card-head"><span>10 · PUBLISH PREFLIGHT</span><em>{latest('preflight_report')?.payload.passed === true ? 'READY' : 'REVIEW'}</em></div><h3>게시 전 검사표</h3><p>출력 형식, 캡션 길이, 소스·EDL 존재 여부를 확인합니다. 자동 업로드 여부는 Production에서 프로젝트별로 정합니다.</p><button onClick={() => void action('게시 전 검사', `/api/projects/${selected}/quality-check`, { stage: 'publish', created_by: botId })} disabled={busy || !selected}>게시 전 검사 실행</button></article>
      </div></section>

      <section className="ops-section"><div className="ops-section-head"><div><p className="kicker">P2 · RECOVERY AND LEARNING</p><h2>실패를 남기고, <span>다음 편집에 반영.</span></h2></div><p>실패한 렌더의 원인과 게시 후 성과 메모는 이 PC의 프로젝트 기록으로만 남습니다.</p></div><div className="ops-grid p2-grid">
        <article className="ops-card recovery-card"><div className="ops-card-head"><span>11 · RECOVERY CENTER</span><em>{operations?.failed_jobs.length ?? 0} failed</em></div><h3>실패 복구 센터</h3>{operations?.failed_jobs.length ? <div className="ops-recovery-list">{operations.failed_jobs.map((job) => <article key={job.id}><b>{job.kind}</b><p>{job.error_text || '실패 원인을 기록하지 못했습니다.'}</p><small>승인된 작업만 기존 Production 대기열에서 재시도할 수 있습니다.</small></article>)}</div> : <p>현재 실패한 로컬 작업이 없습니다. 실패가 생기면 정확한 원인이 여기에 표시됩니다.</p>}</article>
        <article className="ops-card"><div className="ops-card-head"><span>12 · PERFORMANCE NOTES</span><em>{performance.length} note(s)</em></div><h3>콘텐츠 성과 메모</h3><textarea value={performanceNote} onChange={(event) => setPerformanceNote(event.target.value)} /><button onClick={() => void action('성과 메모', `/api/projects/${selected}/artifacts`, { type: 'performance_note', title: '게시 후 성과 메모', payload: { note: performanceNote, use_for: 'next hook and pacing decision' }, created_by: botId })} disabled={busy || !selected}>성과 메모 저장</button><div className="ops-mini-list">{performance.length ? performance.slice(0, 3).map((note) => <span key={note.id}>{text(note.payload.note).slice(0, 74)}</span>) : <small>조회수·저장·댓글과 반응이 좋았던 훅을 기록하세요.</small>}</div></article>
        <article className="ops-card bundle-card"><div className="ops-card-head"><span>13 · PROJECT BUNDLE</span><em>portable JSON</em></div><h3>프로젝트 번들 내보내기·가져오기</h3><p>선택한 프로젝트의 EDL, 작업 이력, 아티팩트를 이식 가능한 JSON으로 내보내거나 다른 로컬 워크스페이스의 번들을 새 프로젝트로 가져옵니다. 원본 미디어 파일은 포함되지 않습니다.</p><button onClick={() => void exportBundle()} disabled={busy || !selected}>선택한 프로젝트 내보내기</button><div className="ops-button-row"><input type="file" accept="application/json" onChange={(event) => setBundleFile(event.target.files?.[0] ?? null)} aria-label="Project bundle file" /><button onClick={() => void importBundle()} disabled={busy || !bundleFile}>번들 가져오기</button></div></article>
      </div></section>
    </main>
  </>;
}
