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
  crew?: boolean;
  collector?: { agent?: string; door?: string };
  editor?: { agent?: string; door?: string };
  spec?: {
    platform?: string;
    duration_seconds?: { min?: number; max?: number };
    captions?: boolean;
    look?: string;
    door?: string;
    agent?: string;
    crew?: boolean;
    collector?: { agent?: string };
    editor?: { agent?: string };
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
  role?: string;
  path?: string;
};

type OutboxDoor = {
  pending_count?: number;
  outbox_dir?: string;
  git_prefix?: string;
  pending?: OutboxItem[];
};

type MaterialsStatus = {
  pending_count?: number;
  pending?: Array<{ id?: string; agent?: string; clip_count?: number }>;
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
  materials?: MaterialsStatus;
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

type CrewDraft = {
  title: string;
  goal: string;
  platform: string;
  min: string;
  max: string;
  captions: boolean;
  look: string;
  must_keep: string;
  must_drop: string;
  collector: string;
};

const emptyDraft = (): CrewDraft => ({
  title: '',
  goal: '',
  platform: 'reels_tiktok_shorts',
  min: '12',
  max: '20',
  captions: true,
  look: '',
  must_keep: '',
  must_drop: '',
  collector: 'Claude',
});

function isCrew(item: EditSpec): boolean {
  return Boolean(item.crew || item.spec?.crew);
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
  const { language, t } = useLanguage();
  const [draft, setDraft] = useState<CrewDraft>(emptyDraft);
  const [collectBrief, setCollectBrief] = useState('');
  const [editBrief, setEditBrief] = useState('');
  const [activeSpecId, setActiveSpecId] = useState('');
  const [saving, setSaving] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [copied, setCopied] = useState('');
  const [error, setError] = useState('');
  const [outboxNotice, setOutboxNotice] = useState('');

  const crewSpecs = useMemo(() => specs.filter((item) => isCrew(item)), [specs]);
  const collecting = crewSpecs.filter((item) => item.status === 'waiting_for_collector');
  const editing = crewSpecs.filter((item) => item.status === 'waiting_for_editor' || item.status === 'waiting_for_bot');
  const received = crewSpecs.filter((item) => item.status === 'received');
  const active = crewSpecs.find((item) => item.id === activeSpecId) || collecting[0] || editing[0] || received[0];
  const collectorName = active?.collector?.agent || active?.spec?.collector?.agent || draft.collector || 'Claude';
  const materialsCount = handoff?.materials?.pending_count ?? 0;

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
          crew: true,
          collector: draft.collector.trim() || 'Claude',
          editor: 'Grok',
        }),
      });
      const record = created.edit_spec as EditSpec & {
        outbox?: {
          collect?: { path?: string; git?: { ok?: boolean } };
          edit?: { path?: string; git?: { ok?: boolean } };
        };
      };
      const collectPrinted = await request(`/api/v2/edit-specs/${record.id}/brief?role=collect`);
      const editPrinted = await request(`/api/v2/edit-specs/${record.id}/brief?role=edit`);
      setActiveSpecId(record.id);
      setCollectBrief(String(collectPrinted.text || ''));
      setEditBrief(String(editPrinted.text || ''));
      if (record.outbox?.collect?.git?.ok && record.outbox?.edit?.git?.ok) {
        setOutboxNotice(t('두 보낼함에 올렸고 git에도 올렸습니다. 수집 봇은 outbox/agents, 편집 봇은 outbox/grok 에서 spec.json 을 읽습니다.', 'Placed in both outboxes and pushed to git. The collector reads outbox/agents; the editor reads outbox/grok.', '已放入两个发件箱并推到 git。收集机器人读 outbox/agents，剪辑机器人读 outbox/grok。', '両方の送信箱に入れ、git にも上げました。収集は outbox/agents、編集は outbox/grok を読む。'));
      } else {
        setOutboxNotice(t('두 보낼함에 올렸습니다. 수집 봇은 handoff-outbox/agents, 편집 봇은 handoff-outbox/grok.', 'Placed in both outboxes. Collector: handoff-outbox/agents. Editor: handoff-outbox/grok.', '已放入两个发件箱。收集：handoff-outbox/agents。剪辑：handoff-outbox/grok。', '両方の送信箱に入れました。収集は handoff-outbox/agents、編集は handoff-outbox/grok。'));
      }
      await onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('규격을 저장하지 못했습니다.', 'Could not save the spec.', '无法保存规格。', '仕様を保存できませんでした。'));
    } finally {
      setSaving(false);
    }
  };

  const copyBrief = async (text: string, key: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(''), 2000);
    } catch {
      setError(t('복사하지 못했습니다. 글을 직접 선택하세요.', 'Could not copy. Select the text instead.', '无法复制。请自行选择文字。', 'コピーできません。テキストを選択してください。'));
    }
  };

  const receiveMaterials = async (demo: boolean) => {
    setPulling(true);
    setError('');
    try {
      const specId = activeSpecId || collecting[0]?.id || editing[0]?.id || '';
      const result = await request('/api/v2/handoff/materials/pull', {
        method: 'POST',
        body: JSON.stringify({ demo, edit_spec_id: specId }),
      });
      const imported = Array.isArray(result.imported) ? result.imported : [];
      if (!imported.length) {
        setError(demo
          ? t('예시 자료를 만들지 못했습니다.', 'Could not write demo materials.', '无法写入示例素材。', 'デモ素材を作れませんでした。')
          : t('아직 수집 봇이 넘긴 자료가 없습니다.', 'No collector materials yet.', '还没有收集到的素材。', '収集素材はまだありません。'));
      }
      await onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('자료를 받지 못했습니다.', 'Could not receive materials.', '无法接收素材。', '素材を受け取れませんでした。'));
    } finally {
      setPulling(false);
    }
  };

  const receiveCut = async (demo: boolean) => {
    setPulling(true);
    setError('');
    try {
      const specId = activeSpecId || editing[0]?.id || collecting[0]?.id || '';
      const result = await request('/api/v2/handoff/pull', {
        method: 'POST',
        body: JSON.stringify({ demo, door: 'grok', edit_spec_id: specId }),
      });
      const imported = Array.isArray(result.imported) ? result.imported as Array<{ project?: { id?: string; handoff_agent?: string }; agent?: string; door?: string }> : [];
      const projectId = imported[0]?.project?.id;
      if (projectId) {
        await onImported(projectId, { door: 'grok', agent: String(imported[0]?.agent || 'Grok') });
        return;
      }
      setError(demo
        ? t('예시 컷을 만들지 못했습니다.', 'Could not write the demo cut.', '无法写入示例剪辑。', 'デモカットを作れませんでした。')
        : t('아직 Grok이 넘긴 컷이 없습니다. 자료가 온 뒤 편집 봇이 돌려줍니다.', 'No editor cut yet. The editor returns it after materials arrive.', '还没有剪辑。素材到了之后由剪辑机器人交回。', 'カットはまだありません。素材のあと編集ボットが返します。'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('받지 못했습니다.', 'Could not receive the package.', '无法接收。', '受け取れませんでした。'));
    } finally {
      setPulling(false);
    }
  };

  const locked = busy || saving || pulling || !studioReady;

  return (
    <div className="desktop-spec-desk">
      <div className="desktop-spec-hero">
        <span>✦</span>
        <h1>{t('봇 두 명이 한 규격을 이어받습니다', 'Two bots share one spec.', '两个机器人接力同一份规格。', 'ボット二人で一つの仕様を引き継ぐ。')}</h1>
        <p>{t('수집 봇이 자료를 모아 자료함에 두고, Grok이 그 클립만 잘라 인박스로 돌려줍니다. 이 책상은 사이트를 긁지 않습니다. 로그인 벽 뒤의 영상은 수집 봇이 운영자가 쓸 수 있는 것만 가져옵니다.', 'The collector drops clips in the materials box. Grok cuts only those clips and returns the cut. This desk does not scrape sites. The collector may only gather sources you are allowed to use.', '收集机器人把素材放进资料箱，Grok 只剪那些片段再交回收件箱。这个工作台不抓网站。收集机器人只能拿你有权使用的来源。', '収集ボットが素材箱にクリップを置き、Grok はそのクリップだけ切って受信箱に返す。このデスクはサイトを掻かない。収集は使える出典だけ。')}</p>
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
        <label className="desktop-spec-field">
          <span>{t('수집 봇', 'Collector', '收集机器人', '収集ボット')}</span>
          <input list="collector-names" value={draft.collector} onChange={(event) => setDraft({ ...draft, collector: event.target.value })} placeholder="Claude / Codex / ChatGPT" />
          <datalist id="collector-names">
            <option value="Claude" />
            <option value="Codex" />
            <option value="ChatGPT" />
            <option value="Gemini" />
            <option value="Cursor" />
          </datalist>
        </label>
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
              : t('규격 저장하고 두 보낼함에 올리기', 'Save to both outboxes', '保存规格并放入两个发件箱', '仕様を保存して両方の送信箱へ')}
          </button>
        </div>
      </form>

      {outboxNotice ? <p className="desktop-spec-outbox" role="status">{outboxNotice}</p> : null}

      <div className="desktop-spec-doors">
        <section className="desktop-spec-door is-agent">
          <div className="desktop-spec-door-head">
            <span>{t('수집', 'Collect', '收集', '収集')}</span>
            <div>
              <b>{t(`${collectorName}가 자료를 모읍니다`, `${collectorName} gathers the clips`, `${collectorName} 收集素材`, `${collectorName} が素材を集める`)}</b>
              <small>{t('사이트를 이 PC에서 긁지 않습니다. 클립과 manifest.json 만 자료함에 둡니다. 컷은 만들지 않습니다.', 'This PC does not scrape. Drop clips and manifest.json in the materials box. Do not make the cut.', '这台电脑不抓站。只把片段和 manifest.json 放进资料箱。不要做成品剪辑。', 'このPCは掻かない。クリップと manifest.json だけ素材箱へ。カットは作らない。')}</small>
            </div>
          </div>
          {collectBrief ? <textarea readOnly value={collectBrief} rows={7} /> : null}
          <div className="desktop-spec-actions">
            {collectBrief ? (
              <button type="button" className="desktop-secondary" onClick={() => void copyBrief(collectBrief, 'collect')}>
                {copied === 'collect' ? t('복사됨', 'Copied', '已复制', 'コピー済み') : t('수집 글 복사', 'Copy collector brief', '复制收集说明', '収集文をコピー')}
              </button>
            ) : null}
            <button type="button" className="desktop-secondary" disabled={locked} onClick={() => void receiveMaterials(false)}>
              {t('수집한 자료 받기', 'Receive collected clips', '接收收集的素材', '収集素材を受け取る')}
            </button>
            <button type="button" className="desktop-secondary" disabled={locked} onClick={() => void receiveMaterials(true)}>
              {t('수집 예시 보기', 'See a collector sample', '查看收集示例', '収集の例を見る')}
            </button>
          </div>
          <p className="desktop-spec-meta">
            {t(`보낼함 ${handoff?.outbox?.doors?.agent?.pending_count ?? 0} · 자료 ${materialsCount} · 수집 대기 ${collecting.length}`, `${handoff?.outbox?.doors?.agent?.pending_count ?? 0} in collector outbox · ${materialsCount} materials · ${collecting.length} waiting`, `发件箱 ${handoff?.outbox?.doors?.agent?.pending_count ?? 0} · 素材 ${materialsCount} · 等待收集 ${collecting.length}`, `送信箱 ${handoff?.outbox?.doors?.agent?.pending_count ?? 0} · 素材 ${materialsCount} · 収集待ち ${collecting.length}`)}
          </p>
        </section>

        <section className="desktop-spec-door is-grok">
          <div className="desktop-spec-door-head">
            <span>Grok</span>
            <div>
              <b>{t('Grok이 그 자료만 편집합니다', 'Grok edits those clips only', 'Grok 只剪那些素材', 'Grok はその素材だけ編集する')}</b>
              <small>{t('자료함의 클립을 잘라 인박스로 돌려줍니다. Runner 페어링도 이 역할입니다.', 'Cuts the materials-box clips and returns them to the inbox. Runner pairing is this role only.', '剪资料箱里的片段并交回收件箱。Runner 配对也只用这个角色。', '素材箱のクリップを切って受信箱に返す。Runner ペアリングもこの役割だけ。')}</small>
            </div>
          </div>
          {editBrief ? <textarea readOnly value={editBrief} rows={7} /> : null}
          <div className="desktop-spec-actions">
            {editBrief ? (
              <button type="button" className="desktop-secondary" onClick={() => void copyBrief(editBrief, 'edit')}>
                {copied === 'edit' ? t('복사됨', 'Copied', '已复制', 'コピー済み') : t('편집 글 복사', 'Copy editor brief', '复制剪辑说明', '編集文をコピー')}
              </button>
            ) : null}
            <button type="button" className="desktop-secondary" disabled={locked} onClick={() => void receiveCut(false)}>
              {t('Grok이 넘긴 편집 받기', 'Receive the Grok cut', '接收 Grok 剪辑', 'Grok の編集を受け取る')}
            </button>
            <button type="button" className="desktop-secondary" disabled={locked} onClick={() => void receiveCut(true)}>
              {t('편집 예시 도착 보기', 'See an editor sample', '查看剪辑示例', '編集の届き方を見る')}
            </button>
          </div>
          <p className="desktop-spec-meta">
            {t(`보낼함 ${handoff?.outbox?.doors?.grok?.pending_count ?? 0} · 편집 대기 ${editing.length} · 받은 컷 ${received.length} · 인박스 ${handoff?.doors?.grok?.pending_count ?? 0}`, `${handoff?.outbox?.doors?.grok?.pending_count ?? 0} in editor outbox · ${editing.length} waiting · ${received.length} received · ${handoff?.doors?.grok?.pending_count ?? 0} inbound`, `发件箱 ${handoff?.outbox?.doors?.grok?.pending_count ?? 0} · 等待剪辑 ${editing.length} · 已收 ${received.length} · 收件 ${handoff?.doors?.grok?.pending_count ?? 0}`, `送信箱 ${handoff?.outbox?.doors?.grok?.pending_count ?? 0} · 編集待ち ${editing.length} · 受取 ${received.length} · 受信 ${handoff?.doors?.grok?.pending_count ?? 0}`)}
          </p>
        </section>
      </div>

      {error ? <p className="desktop-spec-error" role="alert">{error}</p> : null}
      <p className="desktop-spec-meta">
        {t('수집 보낼함: handoff-outbox/agents · 자료함: handoff-materials · 편집 보낼함: handoff-outbox/grok · 컷 인박스: handoff-inbox/grok', 'Collector outbox: handoff-outbox/agents · Materials: handoff-materials · Editor outbox: handoff-outbox/grok · Cut inbox: handoff-inbox/grok', '收集发件箱：handoff-outbox/agents · 资料箱：handoff-materials · 剪辑发件箱：handoff-outbox/grok · 成片收件箱：handoff-inbox/grok', '収集送信箱: handoff-outbox/agents · 素材箱: handoff-materials · 編集送信箱: handoff-outbox/grok · カット受信箱: handoff-inbox/grok')}
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
