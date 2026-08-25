'use client';

import { useEffect, useState } from 'react';
import { LocalizedText } from './language';
import { SiteHeader } from './site-header';

type Json = Record<string, unknown>;
type Gate = { id: 'A' | 'B' | 'C'; label: string; pass: boolean; detail: string };

function readLocal(key: string): Json {
  try { const raw = window.localStorage.getItem(key); return raw ? JSON.parse(raw) as Json : {}; } catch { return {}; }
}
function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
function nested(value: unknown, key: string): Json {
  return value && typeof value === 'object' && !Array.isArray(value) && (value as Json)[key] && typeof (value as Json)[key] === 'object' && !Array.isArray((value as Json)[key]) ? (value as Json)[key] as Json : {};
}
function similarity(one: string, two: string) {
  const words = (value: string) => new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? []); const left = words(one); const right = words(two); const all = new Set([...left, ...right]);
  return [...left].filter((word) => right.has(word)).length / Math.max(1, all.size);
}
function englishOnly(value: string) { return !/[\uAC00-\uD7A3]/.test(value) && /[a-zA-Z]/.test(value); }

function createLocalManifest(): Json {
  const agent = readLocal('localVideoAgentDesk'); const edit = readLocal('localVideoEditLab'); const project = readLocal('localVideoProject'); const captionPacket = readLocal('localVideoPacket');
  return {
    schema: 'local-video-workspace.offline-handoff/v1', generatedAt: new Date().toISOString(), mode: 'offline_local_only', project,
    agent: { role: agent.agentRole, memory: agent.memory, schedule: agent.schedule, labels: agent.labels },
    source: { url: agent.sourceUrl, notes: agent.sourceNotes, trust: agent.trust, originalPostReupload: project.originalReupload },
    edit: { transition: edit.hardCutLock === false ? 'review_required' : 'hard_cut', frameRate: edit.frameRate, renderProfile: edit.renderProfile, captions: edit.captions, audioPolicy: edit.audioPolicy, directorNotes: edit.directorNotes },
    quality: { sourceChecked: agent.sourceChecked, altTextReady: agent.altTextReady, humanReviewRequired: agent.humanReview, shareReady: agent.shareReady }, captionPacket,
    workflow: { grok: 'Copy this file to Grok manually. Paste the returned plan back into this local desk for review.', allowed: ['read_brief', 'propose_edit_plan', 'identify_gate_risks', 'queue_or_auto_upload_instagram'], prohibited: ['source_asset_reuse', 'review_bypass'] },
  };
}

function validateOffline(manifest: Json) {
  const project = nested(manifest, 'project'); const sceneA = nested(project, 'sceneA'); const sceneB = nested(project, 'sceneB'); const agent = nested(manifest, 'agent'); const edit = nested(manifest, 'edit'); const quality = nested(manifest, 'quality'); const packet = nested(manifest, 'captionPacket'); const source = nested(manifest, 'source');
  const copy = [sceneA.headline, sceneA.body, sceneA.accent, sceneB.headline, sceneB.body, sceneB.accent].map(text).filter(Boolean); const duration = Number(project.durationA ?? 0) + Number(project.durationB ?? 0); const likeness = similarity(`${text(sceneA.headline)} ${text(sceneA.body)}`, `${text(sceneB.headline)} ${text(sceneB.body)}`); const tags = Array.isArray(packet.tags) ? packet.tags.filter((tag) => typeof tag === 'string' && tag.trim()) : [];
  const gates: Gate[] = [
    { id: 'A', label: 'Copy discipline', pass: copy.length >= 4 && copy.every(englishOnly), detail: copy.length < 4 ? 'Add the copy for both scenes.' : copy.every(englishOnly) ? 'English copy is present.' : 'Reel copy must remain English only.' },
    { id: 'B', label: 'Cut and contrast', pass: text(edit.transition) === 'hard_cut' && likeness < .8 && text(sceneA.motion) !== text(sceneB.motion) && !Boolean(source.originalPostReupload) && duration >= 8 && duration <= 12, detail: text(edit.transition) !== 'hard_cut' ? 'Use the required hard cut.' : likeness >= .8 ? 'Make the two scenes more different.' : text(sceneA.motion) === text(sceneB.motion) ? 'Give each scene a different camera move.' : Boolean(source.originalPostReupload) ? 'Original-post re-upload must stay off.' : 'Keep the reel between 8 and 12 seconds.' },
    { id: 'C', label: 'Handoff and review', pass: Boolean(text(agent.role) && text(packet.hook) && text(packet.body) && tags.length && text(packet.commentPrompt) && quality.humanReviewRequired), detail: quality.humanReviewRequired ? 'Add the bot role and complete caption packet.' : 'Human review must remain enabled.' },
  ];
  return { mode: 'offline_local_validation', accepted: gates.every((gate) => gate.pass), gates, checks: { durationSeconds: duration, sceneSimilarity: Number(likeness.toFixed(2)), noNetworkRequest: true, humanReviewRequired: Boolean(quality.humanReviewRequired) } };
}

function download(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 700);
}

export default function ConnectConsole() {
  const [manifest, setManifest] = useState<Json>({}); const [result, setResult] = useState(''); const [botReturn, setBotReturn] = useState(''); const [copied, setCopied] = useState(''); const [saved, setSaved] = useState(false);
  useEffect(() => { const hydrate = window.setTimeout(() => { setManifest(createLocalManifest()); setBotReturn(window.localStorage.getItem('localVideoOfflineBotReturn') ?? ''); }, 0); return () => window.clearTimeout(hydrate); }, []);
  const copy = async (name: string, value: string) => { await navigator.clipboard?.writeText(value); setCopied(name); window.setTimeout(() => setCopied(''), 1600); };
  const refresh = () => { setManifest(createLocalManifest()); setSaved(false); };
  const runValidation = () => setResult(JSON.stringify(validateOffline(manifest), null, 2));
  const saveReturn = () => { window.localStorage.setItem('localVideoOfflineBotReturn', botReturn); setSaved(true); window.setTimeout(() => setSaved(false), 1700); };
  const workflow = [['01', 'Prepare locally', 'Edit the Studio, Agent Desk, and Edit Lab. Nothing leaves this device.'], ['02', 'Choose the handoff', 'Copy a brief manually, or let a Grok bot on this same PC enter Local Studio.'], ['03', 'Start locally', 'A local bot enters through POST /api/bot-entry, then reads the guide and prepares a plan.'], ['04', 'Review the plan', 'Paste a manual Grok response below or review the local bot’s recorded work before approval.']];
  return <><SiteHeader current="connect" />
    <main className="connect-main"><section className="connect-hero"><div><p className="kicker"><LocalizedText ko="로컬 봇 전달 도구" en="LOCAL BOT HANDOFF DESK" zh="本地机器人交接台" ja="ローカルボット引き継ぎデスク" /></p><h1><LocalizedText ko="모든 편집을" en="Keep every edit" zh="让每一次剪辑" ja="すべての編集を" /><br /><span><LocalizedText ko="내 컴퓨터 안에 두세요." en="on your machine." zh="都留在你的电脑里。" ja="あなたのパソコンの中に。" /></span></h1><p><LocalizedText ko="이 작업 공간은 외부 API 키나 클라우드 연결 없이 로컬에서 실행됩니다. 봇은 수동 브리프 전달로 참여하거나, 같은 PC에서 실행되는 bot이라면 Local Studio에 입장해 계획 작업을 시작할 수 있습니다." en="This workspace runs locally with no external API key or cloud connection. A bot can participate by manual brief handoff, or a bot running on this same PC can enter Local Studio and begin planning work." zh="此工作区完全在本地运行,无需外部 API 密钥或云端连接。机器人可以通过手动传递简报参与,或者如果是运行在同一台电脑上的机器人,可以进入 Local Studio 并开始规划工作。" ja="このワークスペースは外部 API キーやクラウド接続なしにローカルで動作します。ボットは手動でブリーフを受け渡して参加するか、同じ PC で動作するボットであれば Local Studio に入場して計画作業を開始できます。" /></p></div><aside className="bridge-status ready"><span><LocalizedText ko="로컬 모드" en="LOCAL MODE" zh="本地模式" ja="ローカルモード" /></span><b>LOCAL ONLY</b><p><LocalizedText ko="외부 API 없음 · 키 없음 · 같은 PC의 입장만 허용" en="No external API · no key · same-PC entry only" zh="无外部 API · 无密钥 · 仅限同一台电脑接入" ja="外部 API なし・キーなし・同一 PC からの入場のみ" /></p><button onClick={refresh}><LocalizedText ko="저장된 데이터 새로고침" en="Refresh saved data" zh="刷新已保存的数据" ja="保存済みデータを更新" /></button></aside></section>
      <section className="connect-safety"><b>LOCAL-ONLY BY DESIGN</b><span>Your project state, gate checks, bot return, and downloaded handoff live in this browser on this device.</span><em>Human review stays required.</em></section>
      <section className="connect-grid bridge-overview"><article className="connect-card local-address"><div className="connect-card-head"><span>01 · LOCAL RUN</span><em>One device</em></div><b>localhost · browser storage · Local Studio</b><p>Start this workspace on your own computer without a cloud account or API key. A bot can use the optional Local Studio entry only from this same PC.</p><div><button onClick={() => void copy('manifest', JSON.stringify(manifest, null, 2))}>{copied === 'manifest' ? 'Brief copied' : 'Copy current brief'}</button><button onClick={() => download('local-offline-handoff.json', manifest)}>Download JSON</button></div></article><article className="connect-card setup-card"><div className="connect-card-head"><span>02 · LOCAL-ONLY RULE</span><em>Safe by default</em></div><ol><li>No xAI key is requested or stored.</li><li>No background request is sent to a remote bot service.</li><li>Optional bot entry binds only to 127.0.0.1 on this PC.</li><li>Instagram upload is optional and uses only your locally configured Meta credentials.</li></ol><p>Use the exported JSON manually, or run a same-PC bot through the Local Studio entry contract.</p></article></section>
      <section className="connect-card endpoint-card"><div className="connect-card-head"><span>03 · LOCAL WORKFLOW</span><em>Manual handoff or same-PC bot</em></div><div className="endpoint-list offline-list">{workflow.map(([number, name, detail]) => <article key={number}><span>{number}</span><div><b>{name}</b><p>{detail}</p></div><code>LOCAL</code></article>)}</div></section>
      <section className="connect-grid action-grid"><article className="connect-card manifest-card-local"><div className="connect-card-head"><span>04 · CURRENT OFFLINE BRIEF</span><em>Browser → JSON file</em></div><p>One portable snapshot of your saved Studio, Agent Desk, Edit Lab, and caption packet.</p><div className="manifest-actions"><button onClick={refresh}>Refresh saved data</button><button onClick={() => void copy('manifest-panel', JSON.stringify(manifest, null, 2))}>{copied === 'manifest-panel' ? 'Brief copied' : 'Copy JSON brief'}</button><button onClick={() => download('local-offline-handoff.json', manifest)}>Download JSON</button><button onClick={runValidation}>Run offline gate check</button></div><pre>{JSON.stringify(manifest, null, 2)}</pre></article><article className="connect-card plan-card local-return"><div className="connect-card-head"><span>05 · BOT RETURN INBOX</span><em>Paste manually</em></div><label>Paste a bot’s edit plan<textarea rows={11} value={botReturn} onChange={(event) => setBotReturn(event.target.value)} placeholder="Paste a bot response here after you voluntarily share the exported brief." /></label><button className="plan-button" onClick={saveReturn}>{saved ? 'Saved on this device' : 'Save return locally'}</button><p>This text remains in this browser’s local storage. It is not sent anywhere by this workspace.</p></article></section>
      <section className="connect-card result-card"><div className="connect-card-head"><span>06 · OFFLINE GATE RESPONSE</span><em>Runs in this browser</em></div><pre>{result || 'Run the local gate check to see the current A/B/C result. No request leaves this page.'}</pre></section>
      <section className="connect-rules"><p className="kicker">USAGE RULE</p><h2>Hand Grok the brief.<br />Keep the work local.</h2><div><span>✓ Local project state</span><span>✓ Local gate checks</span><span>✓ Same-PC bot entry</span><span>✓ Optional Instagram auto-upload</span><span>× xAI API key</span><span>× Remote bot access</span></div></section>
    </main><footer className="forge-footer"><span>Local video workspace</span><span>Offline handoff · local storage only</span><span>Runs on this device</span></footer></>;
}
