'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from './language';

type DoorId = 'grok' | 'agent';
type SourceMode = 'collect' | 'own' | 'own_and_collect';

type StyleRecipe = {
  id: string;
  version?: number;
  name?: { ko?: string; en?: string; zh?: string; ja?: string };
  summary?: { ko?: string; en?: string; zh?: string; ja?: string };
  platform?: string;
  aspect?: string;
  duration_seconds?: { min?: number; max?: number };
  captions?: boolean;
  look?: string;
  must_keep?: string;
  must_drop?: string;
  collect?: {
    query?: string;
    clip_count?: { min?: number; max?: number };
    clip_seconds?: { min?: number; max?: number };
  };
};

type EditSpec = {
  id: string;
  status: string;
  project_id?: string | null;
  title: string;
  goal: string;
  door?: string;
  agent?: string;
  crew?: boolean;
  source_mode?: string;
  recipe_id?: string;
  collect_query?: string;
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
    source_mode?: string;
    recipe_id?: string;
    collect_query?: string;
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
  unknown_license_count?: number;
  has_unknown_license?: boolean;
  pending?: Array<{ id?: string; agent?: string; clip_count?: number; unknown_license_count?: number }>;
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

type CrewBot = {
  bot_id?: string;
  display_name?: string;
  presence?: string;
  purpose?: string;
  role_hint?: string;
};

type CrewRoster = {
  bots?: CrewBot[];
  suggested_collector?: string;
  suggested_editor?: string;
};

type SpecDeskProps = {
  specs: EditSpec[];
  recipes?: StyleRecipe[];
  roster?: CrewRoster;
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
  recipe_id: string;
  source_mode: SourceMode;
  platform: string;
  min: string;
  max: string;
  captions: boolean;
  look: string;
  must_keep: string;
  must_drop: string;
  collector: string;
  editor: string;
  collect_query: string;
  collect_min: string;
  collect_max: string;
  owned_text: string;
};

const RECIPE_ORDER = ['instagram_reel', 'tiktok_tight', 'youtube_short', 'youtube_long'] as const;

const emptyDraft = (): CrewDraft => ({
  title: '',
  goal: '',
  recipe_id: 'instagram_reel',
  source_mode: 'collect',
  platform: 'reels_tiktok_shorts',
  min: '21',
  max: '30',
  captions: true,
  look: '',
  must_keep: '',
  must_drop: '',
  collector: '',
  editor: '',
  collect_query: '',
  collect_min: '3',
  collect_max: '8',
  owned_text: '',
});

function localized(map: { ko?: string; en?: string; zh?: string; ja?: string } | undefined, language: string, fallback: string) {
  if (!map) return fallback;
  const key = language.slice(0, 2) as 'ko' | 'en' | 'zh' | 'ja';
  return map[key] || map.en || fallback;
}

function applyRecipe(draft: CrewDraft, recipe: StyleRecipe): CrewDraft {
  return {
    ...draft,
    recipe_id: recipe.id,
    platform: recipe.platform || draft.platform,
    min: String(recipe.duration_seconds?.min ?? draft.min),
    max: String(recipe.duration_seconds?.max ?? draft.max),
    captions: recipe.captions ?? draft.captions,
    look: recipe.look || draft.look,
    must_keep: recipe.must_keep || draft.must_keep,
    must_drop: recipe.must_drop || draft.must_drop,
    collect_query: recipe.collect?.query || draft.collect_query,
    collect_min: String(recipe.collect?.clip_count?.min ?? draft.collect_min),
    collect_max: String(recipe.collect?.clip_count?.max ?? draft.collect_max),
  };
}

function ownedPaths(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function visibleBotName(
  name: string,
  role: 'collect' | 'edit',
  t: (ko: string, en: string, zh: string, ja: string) => string,
) {
  const trimmed = name.trim();
  if (!trimmed || trimmed === 'collector' || trimmed === 'agent') {
    return role === 'collect'
      ? t('수집 봇', 'Collector', '收集机器人', '収集ボット')
      : t('편집 봇', 'Editor', '剪辑机器人', '編集ボット');
  }
  if (trimmed === 'editor') {
    return t('편집 봇', 'Editor', '剪辑机器人', '編集ボット');
  }
  return trimmed;
}

function specMode(item: EditSpec): string {
  return item.source_mode || item.spec?.source_mode || (item.crew || item.spec?.crew ? 'collect' : 'bot');
}

export function SpecDesk({
  specs,
  recipes: recipesProp,
  roster,
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
  const [recipes, setRecipes] = useState<StyleRecipe[]>(recipesProp ?? []);
  const [collectBrief, setCollectBrief] = useState('');
  const [editBrief, setEditBrief] = useState('');
  const [activeSpecId, setActiveSpecId] = useState('');
  const [saving, setSaving] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [copied, setCopied] = useState('');
  const [error, setError] = useState('');
  const [outboxNotice, setOutboxNotice] = useState('');

  useEffect(() => {
    if (recipesProp?.length) {
      setRecipes(recipesProp);
    }
  }, [recipesProp]);

  useEffect(() => {
    if (recipesProp?.length) return;
    let cancelled = false;
    void request('/api/v2/style-recipes').then((payload) => {
      const list = Array.isArray(payload.recipes) ? payload.recipes as StyleRecipe[] : [];
      if (!cancelled && list.length) {
        setRecipes(list);
        const current = list.find((item) => item.id === 'instagram_reel') || list[0];
        if (current) setDraft((value) => applyRecipe(value, current));
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [recipesProp, request]);

  useEffect(() => {
    if (!recipes.length) return;
    setDraft((value) => {
      if (value.look || value.collect_query) return value;
      const current = recipes.find((item) => item.id === value.recipe_id);
      return current ? applyRecipe(value, current) : value;
    });
  }, [recipes]);

  useEffect(() => {
    const suggestedCollector = roster?.suggested_collector || '';
    const suggestedEditor = roster?.suggested_editor || '';
    if (!suggestedCollector && !suggestedEditor) return;
    setDraft((value) => ({
      ...value,
      collector: value.collector || suggestedCollector,
      editor: value.editor || suggestedEditor,
    }));
  }, [roster?.suggested_collector, roster?.suggested_editor]);

  const recipeCards = useMemo(() => {
    const byId = new Map(recipes.map((item) => [item.id, item]));
    return RECIPE_ORDER.map((id) => byId.get(id)).filter((item): item is StyleRecipe => Boolean(item));
  }, [recipes]);

  const collecting = specs.filter((item) => item.status === 'waiting_for_collector');
  const editing = specs.filter((item) => item.status === 'waiting_for_editor' || item.status === 'waiting_for_bot');
  const received = specs.filter((item) => item.status === 'received');
  const active = specs.find((item) => item.id === activeSpecId) || collecting[0] || editing[0] || received[0];
  const connectedBots = roster?.bots ?? [];
  const collectorName = visibleBotName(
    active?.collector?.agent || active?.spec?.collector?.agent || draft.collector,
    'collect',
    t,
  );
  const editorName = visibleBotName(
    active?.editor?.agent || active?.spec?.editor?.agent || draft.editor,
    'edit',
    t,
  );
  const materialsCount = handoff?.materials?.pending_count ?? 0;
  const unknownLicense = handoff?.materials?.unknown_license_count ?? 0;
  const needsCollector = draft.source_mode !== 'own';
  const needsOwned = draft.source_mode !== 'collect';
  const activeRecipeId = active?.recipe_id || active?.spec?.recipe_id || draft.recipe_id;
  const activeRecipe = recipes.find((item) => item.id === activeRecipeId);

  const saveSpec = async () => {
    setSaving(true);
    setError('');
    try {
      const created = await request('/api/v2/edit-specs', {
        method: 'POST',
        body: JSON.stringify({
          title: draft.title.trim(),
          goal: draft.goal.trim(),
          recipe_id: draft.recipe_id,
          source_mode: draft.source_mode,
          platform: draft.platform,
          duration_seconds: { min: Number(draft.min) || 12, max: Number(draft.max) || 20 },
          captions: draft.captions,
          look: draft.look.trim(),
          must_keep: draft.must_keep.trim(),
          must_drop: draft.must_drop.trim(),
          collect_query: draft.collect_query.trim(),
          collect_clip_count: { min: Number(draft.collect_min) || 3, max: Number(draft.collect_max) || 8 },
          owned_paths: ownedPaths(draft.owned_text),
          upload: false,
          language,
          crew: draft.source_mode !== 'own',
          collector: draft.collector.trim() || undefined,
          editor: draft.editor.trim() || undefined,
        }),
      });
      const record = created.edit_spec as EditSpec & {
        outbox?: {
          path?: string;
          git?: { ok?: boolean };
          collect?: { path?: string; git?: { ok?: boolean } };
          edit?: { path?: string; git?: { ok?: boolean } };
        };
      };
      const editPrinted = await request(`/api/v2/edit-specs/${record.id}/brief?role=edit`);
      setActiveSpecId(record.id);
      setEditBrief(String(editPrinted.text || ''));
      if (draft.source_mode !== 'own') {
        const collectPrinted = await request(`/api/v2/edit-specs/${record.id}/brief?role=collect`);
        setCollectBrief(String(collectPrinted.text || ''));
      } else {
        setCollectBrief('');
      }
      if (draft.source_mode === 'own') {
        setOutboxNotice(record.outbox?.git?.ok
          ? t(`${editorName} 보낼함에 올렸고 git에도 올렸습니다. 내 파일만 자릅니다.`, `Placed in the ${editorName} outbox and pushed to git. ${editorName} cuts your files.`, `已放入 ${editorName} 发件箱并推到 git。只剪你的文件。`, `${editorName} 送信箱に入れ、git にも上げました。自分のファイルだけ切る。`)
          : t(`${editorName} 보낼함에 올렸습니다. 내 파일만 자릅니다.`, `Placed in the editor outbox. ${editorName} cuts your files.`, `已放入编辑发件箱。${editorName} 只剪你的文件。`, `編集送信箱に入れました。${editorName} が自分のファイルだけ切る。`));
      } else if (record.outbox?.collect?.git?.ok && record.outbox?.edit?.git?.ok) {
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

  const pickOwned = async () => {
    const picker = typeof window !== 'undefined' ? window.grokCrew?.selectMedia : undefined;
    if (!picker) {
      setError(t('브라우저에서는 경로를 한 줄에 하나씩 붙여 넣으세요. 데스크톱 앱은 파일 고르기를 엽니다.', 'In the browser, paste one local path per line. The desktop app can pick a file.', '浏览器里请每行粘贴一个本机路径。桌面应用可以选文件。', 'ブラウザではパスを1行ずつ貼る。デスクトップアプリはファイルを選べる。'));
      return;
    }
    const picked = await picker();
    if (!picked) return;
    setDraft((value) => ({
      ...value,
      owned_text: value.owned_text.trim() ? `${value.owned_text.trim()}\n${picked}` : picked,
    }));
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
        await onImported(projectId, { door: 'grok', agent: String(imported[0]?.agent || editorName) });
        return;
      }
      setError(demo
        ? t('예시 컷을 만들지 못했습니다.', 'Could not write the demo cut.', '无法写入示例剪辑。', 'デモカットを作れませんでした。')
        : t(`아직 ${editorName}이 넘긴 컷이 없습니다. 자료가 온 뒤 편집 봇이 돌려줍니다.`, `No ${editorName} cut yet. The editor returns it after materials arrive.`, `还没有 ${editorName} 的剪辑。素材到了之后交回。`, `${editorName} のカットはまだありません。素材のあと編集ボットが返します。`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('받지 못했습니다.', 'Could not receive the package.', '无法接收。', '受け取れませんでした。'));
    } finally {
      setPulling(false);
    }
  };

  const locked = busy || saving || pulling || !studioReady;
  const saveLabel = draft.source_mode === 'own'
    ? t(`규격 저장하고 ${editorName} 보낼함에 올리기`, `Save to the ${editorName} outbox`, `保存规格并放入 ${editorName} 发件箱`, `仕様を保存して ${editorName} 送信箱へ`)
    : t('규격 저장하고 두 보낼함에 올리기', 'Save to both outboxes', '保存规格并放入两个发件箱', '仕様を保存して両方の送信箱へ');

  return (
    <div className="desktop-spec-desk">
      <div className="desktop-spec-hero">
        <span>✦</span>
        <h1>{t('스타일을 고르면 규격이 채워집니다', 'Pick a style. The spec fills in.', '选风格，规格会填好。', 'スタイルを選ぶと仕様が埋まる。')}</h1>
        <p>{t('인스타·틱톡·유튜브 레시피를 고르고, 화면은 내 파일인지 수집인지 정하세요. 역할 이름은 체크인한 봇을 따릅니다. 이 책상은 사이트를 긁지 않습니다.', 'Choose Instagram, TikTok, or YouTube, then say whether the pictures are yours or collected. Role names follow the bots that check in. This desk does not scrape sites.', '先选 Instagram、TikTok 或 YouTube，再决定画面从哪来。角色名跟着签到的机器人变。这个工作台不抓网站。', 'Instagram・TikTok・YouTube のレシピを選び、画面の出どころを決める。役割名はチェックインしたボットに従う。このデスクはサイトを掻かない。')}</p>
      </div>

      <form className="desktop-spec-form" onSubmit={(event) => { event.preventDefault(); void saveSpec(); }}>
        <label className="desktop-spec-field">
          <span>{t('제목', 'Title', '标题', 'タイトル')}</span>
          <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder={t('15초 훅 릴', '15s hook Reel', '15秒钩子 Reel', '15秒フックのリール')} required />
        </label>
        <label className="desktop-spec-field desktop-spec-wide">
          <span>{t('무엇을 말할까', 'What should it say', '要讲什么', '何を言うか')}</span>
          <textarea value={draft.goal} onChange={(event) => setDraft({ ...draft, goal: event.target.value })} placeholder={t('가장 센 대사만 남긴 세로 숏폼. 첫 2초에 훅.', 'A vertical short that keeps only the strongest lines. Hook in the first two seconds.', '只留最有力的几句，竖屏短视频。前两秒要有钩子。', '一番強いセリフだけ残した縦型ショート。最初の2秒でフック。')} rows={3} required />
        </label>

        <fieldset className="desktop-spec-recipes">
          <legend>{t('스타일', 'Style', '风格', 'スタイル')}</legend>
          <div className="desktop-spec-recipe-grid">
            {recipeCards.map((recipe) => {
              const selected = draft.recipe_id === recipe.id;
              const seconds = recipe.duration_seconds || {};
              const long = (seconds.max || 0) > 180;
              const length = long
                ? t(`${Math.round((seconds.min || 480) / 60)}–${Math.round((seconds.max || 720) / 60)}분`, `${Math.round((seconds.min || 480) / 60)}–${Math.round((seconds.max || 720) / 60)} min`, `${Math.round((seconds.min || 480) / 60)}–${Math.round((seconds.max || 720) / 60)} 分钟`, `${Math.round((seconds.min || 480) / 60)}–${Math.round((seconds.max || 720) / 60)}分`)
                : t(`${seconds.min}–${seconds.max}초`, `${seconds.min}–${seconds.max}s`, `${seconds.min}–${seconds.max} 秒`, `${seconds.min}–${seconds.max}秒`);
              return (
                <button
                  key={recipe.id}
                  type="button"
                  className={selected ? 'desktop-spec-recipe is-selected' : 'desktop-spec-recipe'}
                  aria-pressed={selected}
                  onClick={() => setDraft((value) => applyRecipe(value, recipe))}
                >
                  <b>{localized(recipe.name, language, recipe.id)}</b>
                  <small>{length} · {recipe.aspect}</small>
                  <span>{localized(recipe.summary, language, '')}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="desktop-spec-sources">
          <legend>{t('화면은 어디서', 'Where do the pictures come from', '画面从哪来', '画面はどこから')}</legend>
          <div className="desktop-spec-source-grid">
            {([
              ['own', t('내 파일', 'My files', '我的文件', '自分のファイル'), t(`이 컴퓨터의 영상만 ${editorName}이 자릅니다. 수집 봇은 부르지 않습니다.`, `${editorName} cuts files already on this computer. No collector.`, `${editorName} 只剪这台电脑上的文件。不叫收集机器人。`, `このPCの映像だけ ${editorName} が切る。収集ボットは呼ばない。`)],
              ['collect', t('수집', 'Collect', '收集', '収集'), t('수집 봇이 쓸 수 있는 출처에서 클립을 모읍니다. 이 PC는 사이트를 긁지 않습니다.', 'The collector gathers allowed clips. This PC does not scrape.', '收集机器人从你能用的来源找片段。这台电脑不抓站。', '収集ボットが使える出典から集める。このPCは掻かない。')],
              ['own_and_collect', t('둘 다', 'Both', '两者', '両方'), t('내 파일이 본편입니다. 수집 봇은 B롤과 커버만 보탭니다.', 'Your files are the A-roll. The collector adds b-roll and covers only.', '你的文件是主画面。收集机器人只补 B-roll 和封面。', '自分のファイルが本編。収集は Bロールとカバーだけ足す。')],
            ] as const).map(([id, label, hint]) => (
              <button
                key={id}
                type="button"
                className={draft.source_mode === id ? 'desktop-spec-source is-selected' : 'desktop-spec-source'}
                aria-pressed={draft.source_mode === id}
                onClick={() => setDraft({ ...draft, source_mode: id })}
              >
                <b>{label}</b>
                <span>{hint}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <p className="desktop-spec-meta">
          {connectedBots.filter((bot) => bot.presence === 'active').length
            ? t(`지금 연결된 봇 ${connectedBots.filter((bot) => bot.presence === 'active').length}명`, `${connectedBots.filter((bot) => bot.presence === 'active').length} bot(s) checked in`, `当前已连接 ${connectedBots.filter((bot) => bot.presence === 'active').length} 个机器人`, `接続中のボット ${connectedBots.filter((bot) => bot.presence === 'active').length} 人`)
            : t('아직 체크인한 봇이 없습니다. 이름을 적거나, 봇이 들어오면 여기 이름이 바뀝니다.', 'No bot has checked in yet. Type a name, or wait for a bot to join.', '还没有机器人签到。可以先写名字，签到后名称会变。', 'まだチェックインしたボットはいない。名前を書くか、ボットが入ると名前が変わる。')}
        </p>
        {needsCollector ? (
          <>
            <label className="desktop-spec-field">
              <span>{t('수집 봇', 'Collector', '收集机器人', '収集ボット')}</span>
              <input list="connected-bot-names" value={draft.collector} onChange={(event) => setDraft({ ...draft, collector: event.target.value })} placeholder={collectorName} />
            </label>
            <label className="desktop-spec-field desktop-spec-wide">
              <span>{t('찾아올 것', 'Find', '要找什么', '探してくるもの')}</span>
              <input value={draft.collect_query} onChange={(event) => setDraft({ ...draft, collect_query: event.target.value })} placeholder={t('카페 오픈, 손, 간판 클로즈업', 'cafe opening, hands, sign close-up', '咖啡馆开业、手、招牌特写', 'カフェ開店、手、看板のクローズアップ')} />
            </label>
            <div className="desktop-spec-row">
              <label className="desktop-spec-field">
                <span>{t('최소 클립', 'Min clips', '最少片段', '最小クリップ')}</span>
                <input type="number" min={1} max={40} value={draft.collect_min} onChange={(event) => setDraft({ ...draft, collect_min: event.target.value })} />
              </label>
              <label className="desktop-spec-field">
                <span>{t('최대 클립', 'Max clips', '最多片段', '最大クリップ')}</span>
                <input type="number" min={1} max={40} value={draft.collect_max} onChange={(event) => setDraft({ ...draft, collect_max: event.target.value })} />
              </label>
            </div>
          </>
        ) : null}
        <label className="desktop-spec-field">
          <span>{t('편집 봇', 'Editor', '剪辑机器人', '編集ボット')}</span>
          <input list="connected-bot-names" value={draft.editor} onChange={(event) => setDraft({ ...draft, editor: event.target.value })} placeholder={editorName} />
          <datalist id="connected-bot-names">
            {connectedBots.map((bot) => (
              <option key={bot.bot_id || bot.display_name} value={bot.display_name || ''} />
            ))}
          </datalist>
        </label>

        {needsOwned ? (
          <label className="desktop-spec-field desktop-spec-wide">
            <span>{t('내 파일 경로', 'My file paths', '我的文件路径', '自分のファイルパス')}</span>
            <textarea
              value={draft.owned_text}
              onChange={(event) => setDraft({ ...draft, owned_text: event.target.value })}
              placeholder={t('한 줄에 경로 하나. 이 PC에 있는 영상만.', 'One local path per line. Files on this computer only.', '每行一个本机路径。只限这台电脑上的视频。', '1行にパス一つ。このPCにある映像だけ。')}
              rows={3}
            />
            <button type="button" className="desktop-secondary" onClick={() => void pickOwned()}>
              {t('이 컴퓨터에서 고르기', 'Pick on this computer', '在这台电脑上选择', 'このパソコンから選ぶ')}
            </button>
          </label>
        ) : null}

        <details className="desktop-spec-advanced">
          <summary>{t('길이·자막·분위기를 직접 고치기', 'Override length, captions, look', '直接改时长、字幕、风格', '長さ・字幕・雰囲気を自分で直す')}</summary>
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
              <input type="number" min={1} max={1200} value={draft.min} onChange={(event) => setDraft({ ...draft, min: event.target.value })} />
            </label>
            <label className="desktop-spec-field">
              <span>{t('최대 초', 'Max seconds', '最长秒数', '最長秒')}</span>
              <input type="number" min={1} max={1200} value={draft.max} onChange={(event) => setDraft({ ...draft, max: event.target.value })} />
            </label>
          </div>
          <label className="desktop-spec-check">
            <input type="checkbox" checked={draft.captions} onChange={(event) => setDraft({ ...draft, captions: event.target.checked })} />
            <span>{t('자막 넣기', 'Burn in captions', '烧录字幕', '字幕を入れる')}</span>
          </label>
          <label className="desktop-spec-field">
            <span>{t('분위기', 'Look', '风格', '雰囲気')}</span>
            <input value={draft.look} onChange={(event) => setDraft({ ...draft, look: event.target.value })} />
          </label>
          <label className="desktop-spec-field">
            <span>{t('꼭 남길 것', 'Must keep', '必须留下', '必ず残す')}</span>
            <input value={draft.must_keep} onChange={(event) => setDraft({ ...draft, must_keep: event.target.value })} />
          </label>
          <label className="desktop-spec-field">
            <span>{t('버릴 것', 'Must drop', '必须去掉', '捨てるもの')}</span>
            <input value={draft.must_drop} onChange={(event) => setDraft({ ...draft, must_drop: event.target.value })} />
          </label>
        </details>

        <div className="desktop-spec-actions">
          <button type="submit" className="desktop-primary" disabled={locked}>
            {saving ? t('저장 중…', 'Saving…', '保存中…', '保存中…') : saveLabel}
          </button>
        </div>
      </form>

      {outboxNotice ? <p className="desktop-spec-outbox" role="status">{outboxNotice}</p> : null}
      {unknownLicense > 0 ? <p className="desktop-spec-license" role="status">{t(`출처 불명 클립 ${unknownLicense}장. 올리기 전에 라이선스를 확인하세요.`, `${unknownLicense} clip(s) have an unknown license. Check before you publish.`, `有 ${unknownLicense} 个片段来源不明。发布前请核对许可。`, `出典不明のクリップが ${unknownLicense}。投稿前にライセンスを確認。`)}</p> : null}

      <div className="desktop-spec-doors">
        {needsCollector ? (
          <section className="desktop-spec-door is-agent">
            <div className="desktop-spec-door-head">
              <span>{t('수집', 'Collect', '收集', '収集')}</span>
              <div>
                <b>{t(`${collectorName} · 자료를 모읍니다`, `${collectorName} gathers the clips`, `${collectorName} 收集素材`, `${collectorName} が素材を集める`)}</b>
                <small>{activeRecipe ? localized(activeRecipe.name, language, activeRecipe.id) : t('레시피 없음', 'No recipe', '无风格', 'レシピなし')} · {t('사이트를 이 PC에서 긁지 않습니다. 클립과 manifest.json 만 자료함에 둡니다. 컷은 만들지 않습니다.', 'This PC does not scrape. Drop clips and manifest.json in the materials box. Do not make the cut.', '这台电脑不抓站。只把片段和 manifest.json 放进资料箱。不要做成品剪辑。', 'このPCは掻かない。クリップと manifest.json だけ素材箱へ。カットは作らない。')}</small>
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
        ) : (
          <section className="desktop-spec-door is-agent">
            <div className="desktop-spec-door-head">
              <span>{t('수집', 'Collect', '收集', '収集')}</span>
              <div>
                <b>{t('이 규격은 수집하지 않습니다', 'This spec does not collect', '这份规格不收集', 'この仕様は収集しない')}</b>
                <small>{t('내 파일만 씁니다. 수집 보낼함은 비어 있습니다.', 'Your files only. The collector outbox stays empty.', '只用你的文件。收集发件箱为空。', '自分のファイルだけ。収集送信箱は空。')}</small>
              </div>
            </div>
          </section>
        )}

        <section className="desktop-spec-door is-grok">
          <div className="desktop-spec-door-head">
            <span>{editorName}</span>
            <div>
              <b>{t(`${editorName} · 그 자료만 편집합니다`, `${editorName} edits those clips only`, `${editorName} 只剪那些素材`, `${editorName} はその素材だけ編集する`)}</b>
              <small>{activeRecipe ? localized(activeRecipe.name, language, activeRecipe.id) : t('레시피 없음', 'No recipe', '无风格', 'レシピなし')} · {specMode(active || { id: '', status: '', title: '', goal: '' }) === 'own' ? t('자료함의 내 파일을 자릅니다.', 'Cuts your files in the materials box.', '剪资料箱里你的文件。', '素材箱の自分のファイルを切る。') : t('자료함의 클립을 잘라 인박스로 돌려줍니다. Runner 페어링도 이 역할입니다.', 'Cuts the materials-box clips and returns them to the inbox. Runner pairing is this role only.', '剪资料箱里的片段并交回收件箱。Runner 配对也只用这个角色。', '素材箱のクリップを切って受信箱に返す。Runner ペアリングもこの役割だけ。')}</small>
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
              {t(`${editorName} 편집 받기`, `Receive the ${editorName} cut`, `接收 ${editorName} 剪辑`, `${editorName} の編集を受け取る`)}
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
        <summary>{t('타임라인에서 이 컴퓨터 영상을 직접 열기', 'Open a file on the timeline yourself', '在时间线上直接打开本机视频', 'タイムラインでこのパソコンの映像を開く')}</summary>
        <div className="desktop-empty-actions">
          {sampleAvailable ? <button type="button" className="desktop-secondary" disabled={busy || !studioReady} onClick={onOpenSample}>{t('화면 확인용 샘플', 'Preview sample', '预览示例', '画面確認用サンプル')}</button> : null}
          <button type="button" className="desktop-secondary" disabled={busy || !studioReady} onClick={onOpenOwnFootage}>{t('내 파일 열기', 'Open my file', '打开我的文件', '自分のファイルを開く')}</button>
        </div>
      </details>
    </div>
  );
}
