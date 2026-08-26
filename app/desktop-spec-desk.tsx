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

type OutboxItem = {
  id?: string;
  title?: string;
  agent?: string;
  path?: string;
};

type OutboxDoor = {
  pending_count?: number;
  outbox_dir?: string;
  git_prefix?: string;
  pending?: OutboxItem[];
};

type HandoffStatus = {
  pending_count?: number;
  git_configured?: boolean;
  doors?: {
    grok?: DoorStatus;
    agent?: DoorStatus;
  };
  outbox?: {
    pending_count?: number;
    git_configured?: boolean;
    doors?: {
      grok?: OutboxDoor;
      agent?: OutboxDoor;
    };
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
  onImported: (projectId: string, sender?: { door: DoorId; agent: string }) => Promise<void>;
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
  outbox,
  gitConfigured,
  busy,
  studioReady,
  onImported,
  onRefresh,
  request,
}: {
  door: DoorId;
  specs: EditSpec[];
  pendingCount: number;
  outbox?: OutboxDoor;
  gitConfigured: boolean;
  busy: boolean;
  studioReady: boolean;
  onImported: (projectId: string, sender?: { door: DoorId; agent: string }) => Promise<void>;
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
  const [outboxNotice, setOutboxNotice] = useState('');

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
      const record = created.edit_spec as EditSpec & { outbox?: { path?: string; git_prefix?: string; git?: { ok?: boolean; skipped?: boolean; reason?: string } } };
      const printed = await request(`/api/v2/edit-specs/${record.id}/brief`);
      setActiveSpecId(record.id);
      setBrief(String(printed.text || ''));
      const outboxPath = record.outbox?.path || '';
      const git = record.outbox?.git;
      if (outboxPath && git?.ok) {
        setOutboxNotice(t(`보낼함에 올렸고 git에도 올렸습니다. 봇은 ${record.outbox?.git_prefix} 에서 spec.json 을 읽습니다.`, `Placed in the outbox and pushed to git. The bot reads spec.json under ${record.outbox?.git_prefix}.`, `已放入发件箱并推到 git。机器人从 ${record.outbox?.git_prefix} 读取 spec.json。`, `送信箱に入れ、git にも上げました。ボットは ${record.outbox?.git_prefix} の spec.json を読みます。`));
      } else if (outboxPath) {
        setOutboxNotice(t(`보낼함에 올렸습니다. ${outboxPath}`, `Placed in the outbox. ${outboxPath}`, `已放入发件箱。${outboxPath}`, `送信箱に入れました。${outboxPath}`));
      }
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
      const imported = Array.isArray(result.imported) ? result.imported as Array<{ project?: { id?: string; handoff_agent?: string }; agent?: string; door?: string }> : [];
      const projectId = imported[0]?.project?.id;
      if (projectId) {
        const agent = String(imported[0]?.agent || imported[0]?.project?.handoff_agent || (door === 'grok' ? 'Grok' : 'agent'));
        await onImported(projectId, { door, agent });
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
            <input list="agent-names" value={draft.agent} onChange={(event) => setDraft({ ...draft, agent: event.target.value })} placeholder="Claude / Codex / ChatGPT" />
            <datalist id="agent-names">
              <option value="Claude" />
              <option value="Codex" />
              <option value="ChatGPT" />
              <option value="Gemini" />
              <option value="Cursor" />
            </datalist>
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
                ? t('규격 저장하고 Grok 보낼함에 올리기', 'Save to the Grok outbox', '保存规格并放入 Grok 发件箱', '仕様を保存して Grok 送信箱へ')
                : t('규격 저장하고 다른 에이전트 보낼함에 올리기', 'Save to the other-agent outbox', '保存规格并放入其他代理发件箱', '仕様を保存して他エージェント送信箱へ')}
          </button>
        </div>
      </form>

      {outboxNotice ? <p className="desktop-spec-outbox" role="status">{outboxNotice}</p> : null}

      {brief ? (
        <div className="desktop-spec-brief">
          <div className="desktop-card-title">
            <span>02</span>
            <div>
              <b>{grokDoor
                ? t('봇은 보낼함의 spec.json 을 읽습니다', 'The bot reads spec.json from this outbox', '机器人从发件箱读取 spec.json', 'ボットはこの送信箱の spec.json を読む')
                : t('그 에이전트는 보낼함의 spec.json 을 읽습니다', 'That agent reads spec.json from this outbox', '该代理从发件箱读取 spec.json', 'そのエージェントはこの送信箱の spec.json を読む')}</b>
              <small>{t('글을 복사하는 것은 예비입니다. 원본 파일은 보내지 않습니다.', 'Copying the text is a backup. Do not send a source file.', '复制文字只是备用。不要发送原片。', '文のコピーは予備。原版は送らない。')}</small>
            </div>
          </div>
          <textarea readOnly value={brief} rows={8} />
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
        {t(`보낼함 ${outbox?.pending_count ?? 0} · 대기 ${waiting.length} · 받은 컷 ${received.length} · 받을 폴더 ${pendingCount}`, `${outbox?.pending_count ?? 0} in outbox · ${waiting.length} waiting · ${received.length} received · ${pendingCount} inbound`, `发件箱 ${outbox?.pending_count ?? 0} · 等待 ${waiting.length} · 已收 ${received.length} · 收件 ${pendingCount}`, `送信箱 ${outbox?.pending_count ?? 0} · 待ち ${waiting.length} · 受取 ${received.length} · 受信 ${pendingCount}`)}
        {gitConfigured ? ` · ${t('git 연결됨', 'git is set', '已设置 git', 'git 設定済み')}` : ''}
        {received[0]?.agent ? ` · ${received.map((item) => item.agent).filter(Boolean).slice(0, 3).join(', ')}` : ''}
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
        <h1>{t('규격을 저장하면 그 문 보낼함에 올라갑니다', 'Save the spec. It goes in that door\'s outbox.', '保存规格后会进入那扇门的发件箱。', '仕様を保存すると、そのドアの送信箱に入る。')}</h1>
        <p>{t('봇이 자기 문 보낼함에서 spec.json 을 가져가 소스와 컷을 만들고, 같은 문 인박스로 돌려줍니다. Grok과 다른 에이전트는 섞이지 않습니다. 글을 복사하는 것은 예비입니다.', 'The bot picks spec.json from its outbox, makes the source and the cut, and returns them to the same door\'s inbox. Grok and other agents stay apart. Copying the text is only a backup.', '机器人从自己的发件箱取 spec.json，做好素材和剪辑后再交回同一扇门的收件箱。Grok 和其他代理不会混用。复制文字只是备用。', 'ボットは自分の送信箱から spec.json を取り、素材とカットを作って同じドアの受信箱に返す。Grok と他エージェントは混ざらない。文のコピーは予備。')}</p>
      </div>

      <div className="desktop-spec-doors">
        <DoorCard
          door="grok"
          specs={specs}
          pendingCount={handoff?.doors?.grok?.pending_count ?? 0}
          outbox={handoff?.outbox?.doors?.grok}
          gitConfigured={Boolean(handoff?.git_configured || handoff?.outbox?.git_configured)}
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
          outbox={handoff?.outbox?.doors?.agent}
          gitConfigured={Boolean(handoff?.git_configured || handoff?.outbox?.git_configured)}
          busy={busy}
          studioReady={studioReady}
          onImported={onImported}
          onRefresh={onRefresh}
          request={request}
        />
      </div>

      <p className="desktop-spec-meta">
        {t('보낼함: handoff-outbox/grok · handoff-outbox/agents · 인박스: handoff-inbox/grok · handoff-inbox/agents', 'Outbox: handoff-outbox/grok · handoff-outbox/agents · Inbox: handoff-inbox/grok · handoff-inbox/agents', '发件箱：handoff-outbox/grok · handoff-outbox/agents · 收件箱：handoff-inbox/grok · handoff-inbox/agents', '送信箱: handoff-outbox/grok · handoff-outbox/agents · 受信箱: handoff-inbox/grok · handoff-inbox/agents')}
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
