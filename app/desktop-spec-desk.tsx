'use client';

import { useMemo, useState } from 'react';
import { useLanguage } from './language';

type DoorId = 'grok' | 'agent';

type EditSpec = {
  id: string;
  status: string;
  project_id?: string | null;
  title: string;
  goal: string;
  door?: string;
  agent?: string;
  spec?: {
    platform?: string;
    duration_seconds?: { min?: number; max?: number };
    captions?: boolean;
    look?: string;
    door?: string;
    agent?: string;
  };
};

type DoorStatus = {
  pending_count?: number;
  inbox_dir?: string;
};

type HandoffStatus = {
  pending_count?: number;
  git_configured?: boolean;
  doors?: {
    grok?: DoorStatus;
    agent?: DoorStatus;
  };
};

type JsonObject = Record<string, unknown>;

type SpecDeskProps = {
  specs: EditSpec[];
  handoff?: HandoffStatus;
  busy: boolean;
  studioReady: boolean;
  sampleAvailable: boolean;
  onOpenSample: () => void;
  onOpenOwnFootage: () => void;
  onImported: (projectId: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  request: (path: string, init?: RequestInit) => Promise<JsonObject>;
};

type DoorDraft = {
  title: string;
  goal: string;
  platform: string;
  min: string;
  max: string;
  captions: boolean;
  look: string;
  must_keep: string;
  must_drop: string;
  agent: string;
};

const emptyDraft = (door: DoorId): DoorDraft => ({
  title: '',
  goal: '',
  platform: 'reels_tiktok_shorts',
  min: '12',
  max: '20',
  captions: true,
  look: '',
  must_keep: '',
  must_drop: '',
  agent: door === 'grok' ? 'Grok' : '',
});

function specDoor(item: EditSpec): DoorId {
  const value = item.door || item.spec?.door || 'grok';
  return value === 'agent' ? 'agent' : 'grok';
}

function DoorCard({
  door,
  specs,
  pendingCount,
  busy,
  studioReady,
  onImported,
  onRefresh,
  request,
}: {
  door: DoorId;
  specs: EditSpec[];
  pendingCount: number;
  busy: boolean;
  studioReady: boolean;
  onImported: (projectId: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  request: (path: string, init?: RequestInit) => Promise<JsonObject>;
}) {
  const { language, t } = useLanguage();
  const [draft, setDraft] = useState<DoorDraft>(() => emptyDraft(door));
  const [brief, setBrief] = useState('');
  const [activeSpecId, setActiveSpecId] = useState('');
  const [saving, setSaving] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const waiting = useMemo(
    () => specs.filter((item) => item.status === 'waiting_for_bot' && specDoor(item) === door),
    [specs, door],
  );
  const received = useMemo(
    () => specs.filter((item) => item.status === 'received' && specDoor(item) === door),
    [specs, door],
  );

  const saveSpec = async () => {
    setSaving(true);
    setError('');
    try {
      const created = await request('/api/v2/edit-specs', {
        method: 'POST',
        body: JSON.stringify({
          title: draft.title.trim(),
          goal: draft.goal.trim(),
          platform: draft.platform,
          duration_seconds: { min: Number(draft.min) || 12, max: Number(draft.max) || 20 },
          captions: draft.captions,
          look: draft.look.trim(),
          must_keep: draft.must_keep.trim(),
          must_drop: draft.must_drop.trim(),
          upload: false,
          language,
          door,
          agent: door === 'grok' ? 'Grok' : draft.agent.trim() || 'agent',
        }),
      });
      const record = created.edit_spec as EditSpec;
      const printed = await request(`/api/v2/edit-specs/${record.id}/brief`);
      setActiveSpecId(record.id);
      setBrief(String(printed.text || ''));
      await onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('규격을 저장하지 못했습니다.', 'Could not save the spec.', '无法保存规格。', '仕様を保存できませんでした。'));
    } finally {
      setSaving(false);
    }
  };

  const copyBrief = async () => {
    if (!brief) return;
    try {
      await navigator.clipboard.writeText(brief);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t('복사하지 못했습니다. 글을 직접 선택하세요.', 'Could not copy. Select the text instead.', '无法复制。请自行选择文字。', 'コピーできません。テキストを選択してください。'));
    }
  };

  const receiveBotCut = async (demo: boolean) => {
    setPulling(true);
    setError('');
    try {
      const result = await request('/api/v2/handoff/pull', {
        method: 'POST',
        body: JSON.stringify({
          demo,
          door,
          edit_spec_id: activeSpecId || waiting[0]?.id || '',
        }),
      });
      const imported = Array.isArray(result.imported) ? result.imported as Array<{ project?: { id?: string } }> : [];
      const projectId = imported[0]?.project?.id;
      if (projectId) {
        await onImported(projectId);
        return;
      }
      if (demo) {
        setError(t('예시 패키지를 만들지 못했습니다.', 'Could not write the demo package.', '无法写入示例包。', 'デモパッケージを作れませんでした。'));
      } else {
        setError(door === 'grok'
          ? t('아직 Grok이 넘긴 폴더가 없습니다. 글을 복사해 다른 컴퓨터의 Grok에게 주세요.', 'No Grok package yet. Copy the brief and give it to Grok on another computer.', '还没有 Grok 包。请复制说明并交给另一台电脑上的 Grok。', 'Grok の包はまだありません。文をコピーして別のパソコンの Grok に渡してください。')
          : t('아직 다른 에이전트가 넘긴 폴더가 없습니다. 글을 복사해 Claude·Codex·ChatGPT에게 주세요.', 'No other-agent package yet. Copy the brief and give it to Claude, Codex, or ChatGPT.', '还没有其他代理包。请复制说明并交给 Claude、Codex 或 ChatGPT。', '他エージェントの包はまだありません。文をコピーして Claude・Codex・ChatGPT に渡してください。'));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('받지 못했습니다.', 'Could not receive the package.', '无法接收。', '受け取れませんでした。'));
    } finally {
      setPulling(false);
    }
  };

  const locked = busy || saving || pulling || !studioReady;
  const grokDoor = door === 'grok';

  return (
    <section className={`desktop-spec-door ${grokDoor ? 'is-grok' : 'is-agent'}`}>
      <div className="desktop-spec-door-head">
        <span>{grokDoor ? 'Grok' : t('다른 에이전트', 'Other agents', '其他代理', '他のエージェント')}</span>
        <div>
          <b>{grokDoor
            ? t('Grok 전용 문', 'Grok-only door', 'Grok 专用门', 'Grok 専用ドア')
            : t('다른 에이전트 전용 문', 'Other-agent door', '其他代理专用门', '他エージェント専用ドア')}</b>
          <small>{grokDoor
            ? t('Grok만 이 규격을 이행합니다. Runner 페어링도 이 문입니다. agents/ 폴더는 쓰지 마세요.', 'Only Grok fulfills this spec. Runner pairing is this door only. Do not use the agents/ folder.', '只有 Grok 履行此规格。Runner 配对也只用这扇门。不要用 agents/ 文件夹。', 'Grok だけがこの仕様を履行します。Runner ペアリングもこのドアだけ。agents/ は使わない。')
            : t('Claude, Codex, ChatGPT, Gemini, Cursor. Grok 문과 Runner는 쓰지 마세요.', 'Claude, Codex, ChatGPT, Gemini, Cursor. Do not use the Grok door or Runner.', 'Claude、Codex、ChatGPT、Gemini、Cursor。不要用 Grok 门和 Runner。', 'Claude、Codex、ChatGPT、Gemini、Cursor。Grok ドアと Runner は使わない。')}</small>
        </div>
      </div>

      <form className="desktop-spec-form" onSubmit={(event) => { event.preventDefault(); void saveSpec(); }}>
        <label className="desktop-spec-field">
          <span>{t('제목', 'Title', '标题', 'タイトル')}</span>
          <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder={t('15초 훅 릴', '15s hook Reel', '15秒钩子 Reel', '15秒フックのリール')} required />
        </label>
        <label className="desktop-spec-field desktop-spec-wide">
          <span>{t('어떻게 만들까', 'How should it feel', '做成什么样', 'どう作るか')}</span>
          <textarea value={draft.goal} onChange={(event) => setDraft({ ...draft, goal: event.target.value })} placeholder={t('가장 센 대사만 남긴 세로 숏폼. 첫 2초에 훅.', 'A vertical short that keeps only the strongest lines. Hook in the first two seconds.', '只留最有力的几句，竖屏短视频。前两秒要有钩子。', '一番強いセリフだけ残した縦型ショート。最初の2秒でフック。')} rows={3} required />
        </label>
        {!grokDoor ? (
          <label className="desktop-spec-field">
            <span>{t('에이전트 이름', 'Agent name', '代理名称', 'エージェント名')}</span>
            <input value={draft.agent} onChange={(event) => setDraft({ ...draft, agent: event.target.value })} placeholder="Claude / Codex / ChatGPT" />
          </label>
        ) : null}
        <div className="desktop-spec-row">
          <label className="desktop-spec-field">
            <span>{t('형태', 'Shape', '形态', '形')}</span>
            <select value={draft.platform} onChange={(event) => setDraft({ ...draft, platform: event.target.value })}>
              <option value="reels_tiktok_shorts">9:16 Reels / TikTok / Shorts</option>
              <option value="feed_square">1:1 {t('피드', 'Feed', '信息流', 'フィード')}</option>
              <option value="landscape">16:9</option>
            </select>
          </label>
          <label className="desktop-spec-field">
            <span>{t('최소 초', 'Min seconds', '最短秒数', '最短秒')}</span>
            <input type="number" min={1} max={180} value={draft.min} onChange={(event) => setDraft({ ...draft, min: event.target.value })} />
          </label>
          <label className="desktop-spec-field">
            <span>{t('최대 초', 'Max seconds', '最长秒数', '最長秒')}</span>
            <input type="number" min={1} max={180} value={draft.max} onChange={(event) => setDraft({ ...draft, max: event.target.value })} />
          </label>
        </div>
        <label className="desktop-spec-check">
          <input type="checkbox" checked={draft.captions} onChange={(event) => setDraft({ ...draft, captions: event.target.checked })} />
          <span>{t('자막 넣기', 'Burn in captions', '烧录字幕', '字幕を入れる')}</span>
        </label>
        <label className="desktop-spec-field">
          <span>{t('분위기', 'Look', '风格', '雰囲気')}</span>
          <input value={draft.look} onChange={(event) => setDraft({ ...draft, look: event.target.value })} placeholder={t('자연스럽게, 너무 과하지 않게', 'Natural, not too processed', '自然，不要太过', '自然に、加工しすぎない')} />
        </label>
        <label className="desktop-spec-field">
          <span>{t('꼭 남길 것', 'Must keep', '必须留下', '必ず残す')}</span>
          <input value={draft.must_keep} onChange={(event) => setDraft({ ...draft, must_keep: event.target.value })} />
        </label>
        <label className="desktop-spec-field">
          <span>{t('버릴 것', 'Must drop', '必须去掉', '捨てるもの')}</span>
          <input value={draft.must_drop} onChange={(event) => setDraft({ ...draft, must_drop: event.target.value })} />
        </label>
        <div className="desktop-spec-actions">
          <button type="submit" className="desktop-primary" disabled={locked}>
            {saving
              ? t('저장 중…', 'Saving…', '保存中…', '保存中…')
              : grokDoor
                ? t('Grok에게 보낼 글 만들기', 'Save the Grok brief', '生成给 Grok 的说明', 'Grok 用の文を作る')
                : t('다른 에이전트에게 보낼 글 만들기', 'Save the other-agent brief', '生成给其他代理的说明', '他エージェント用の文を作る')}
          </button>
        </div>
      </form>

      {brief ? (
        <div className="desktop-spec-brief">
          <div className="desktop-card-title">
            <span>02</span>
            <div>
              <b>{grokDoor
                ? t('이 글을 다른 컴퓨터의 Grok에게 주세요', 'Give this text to Grok on another computer', '把这段话交给另一台电脑上的 Grok', '別のパソコンの Grok にこの文を渡す')
                : t('이 글을 다른 컴퓨터의 에이전트에게 주세요', 'Give this text to the other agent', '把这段话交给另一台电脑上的代理', '別のパソコンの他エージェントにこの文を渡す')}</b>
              <small>{t('원본 파일은 보내지 않습니다. 그 문이 소스와 컷을 만듭니다.', 'Do not send a source file. That door makes the footage and the cut.', '不要发送原片。由这扇门做素材和剪辑。', '原版は送らない。素材とカットはそのドアが作る。')}</small>
            </div>
          </div>
          <textarea readOnly value={brief} rows={10} />
        </div>
      ) : null}

      <div className="desktop-spec-actions">
        {brief ? (
          <button type="button" className="desktop-primary" onClick={() => void copyBrief()}>
            {copied ? t('복사됨', 'Copied', '已复制', 'コピー済み') : t('글 복사', 'Copy the brief', '复制说明', '文をコピー')}
          </button>
        ) : null}
        <button type="button" className="desktop-secondary" disabled={locked} onClick={() => void receiveBotCut(false)}>
          {grokDoor
            ? t('Grok이 넘긴 편집 받기', 'Receive the Grok cut', '接收 Grok 剪辑', 'Grok の編集を受け取る')
            : t('다른 에이전트가 넘긴 편집 받기', 'Receive the other-agent cut', '接收其他代理剪辑', '他エージェントの編集を受け取る')}
        </button>
        <button type="button" className="desktop-secondary" disabled={locked} onClick={() => void receiveBotCut(true)}>
          {t('이 문으로 예시 도착 보기', 'See a sample on this door', '查看此门的示例送达', 'このドアの届き方を見る')}
        </button>
      </div>

      {error ? <p className="desktop-spec-error" role="alert">{error}</p> : null}
      <p className="desktop-spec-meta">
        {t(`대기 ${waiting.length} · 받은 컷 ${received.length} · 폴더 ${pendingCount}`, `${waiting.length} waiting · ${received.length} received · ${pendingCount} folders`, `等待 ${waiting.length} · 已收 ${received.length} · 文件夹 ${pendingCount}`, `待ち ${waiting.length} · 受取 ${received.length} · フォルダ ${pendingCount}`)}
      </p>
    </section>
  );
}

export function SpecDesk({
  specs,
  handoff,
  busy,
  studioReady,
  sampleAvailable,
  onOpenSample,
  onOpenOwnFootage,
  onImported,
  onRefresh,
  request,
}: SpecDeskProps) {
  const { t } = useLanguage();

  return (
    <div className="desktop-spec-desk">
      <div className="desktop-spec-hero">
        <span>✦</span>
        <h1>{t('문은 두 개입니다. 규격만 적으면 그 문이 영상과 편집을 넘깁니다', 'Two doors. You write the brief. That door brings the footage and the cut.', '两扇门。你只写规格。那扇门送来素材和剪辑。', 'ドアは二つ。仕様だけ書く。映像と編集はそのドアが渡す。')}</h1>
        <p>{t('Grok에게 맡길 일과 Claude·Codex·ChatGPT에게 맡길 일을 섞지 마세요. 각 문은 자기 인박스만 봅니다. 원본은 이 컴퓨터에 두지 않아도 됩니다.', 'Do not mix Grok work with Claude, Codex, or ChatGPT. Each door reads only its own inbox. You do not have to drop a file here.', '不要把 Grok 的工作和 Claude、Codex、ChatGPT 混在一起。每扇门只看自己的收件箱。不必把原片放在这台电脑。', 'Grok の仕事と Claude・Codex・ChatGPT を混ぜない。各ドアは自分の受信箱だけ見る。原版をこのパソコンに置かなくて大丈夫。')}</p>
      </div>

      <div className="desktop-spec-doors">
        <DoorCard
          door="grok"
          specs={specs}
          pendingCount={handoff?.doors?.grok?.pending_count ?? 0}
          busy={busy}
          studioReady={studioReady}
          onImported={onImported}
          onRefresh={onRefresh}
          request={request}
        />
        <DoorCard
          door="agent"
          specs={specs}
          pendingCount={handoff?.doors?.agent?.pending_count ?? 0}
          busy={busy}
          studioReady={studioReady}
          onImported={onImported}
          onRefresh={onRefresh}
          request={request}
        />
      </div>

      <p className="desktop-spec-meta">
        {handoff?.git_configured ? t('git 인계 연결됨 · 원격 패키지도 grok/ 또는 agents/ 아래에 두세요', 'git handoff is set · remote packages also go under grok/ or agents/', '已设置 git 交接 · 远程包也放在 grok/ 或 agents/ 下', 'git 引き継ぎ設定済み · リモート包も grok/ か agents/ の下へ') : t('로컬 인박스: handoff-inbox/grok 와 handoff-inbox/agents', 'Local inboxes: handoff-inbox/grok and handoff-inbox/agents', '本地收件箱：handoff-inbox/grok 与 handoff-inbox/agents', 'ローカル受信箱: handoff-inbox/grok と handoff-inbox/agents')}
      </p>

      <details className="desktop-spec-advanced">
        <summary>{t('이 컴퓨터에 이미 있는 영상으로 직접 열기', 'Open a file that is already on this computer', '直接打开这台电脑上已有的视频', 'このパソコンにある映像を自分で開く')}</summary>
        <div className="desktop-empty-actions">
          {sampleAvailable ? <button type="button" className="desktop-secondary" disabled={busy || !studioReady} onClick={onOpenSample}>{t('화면 확인용 샘플', 'Preview sample', '预览示例', '画面確認用サンプル')}</button> : null}
          <button type="button" className="desktop-secondary" disabled={busy || !studioReady} onClick={onOpenOwnFootage}>{t('내 파일 열기', 'Open my file', '打开我的文件', '自分のファイルを開く')}</button>
        </div>
      </details>
    </div>
  );
}
