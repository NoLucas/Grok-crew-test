'use client';

import { useMemo, useState } from 'react';
import { useLanguage } from './language';

type EditSpec = {
  id: string;
  status: string;
  project_id?: string | null;
  title: string;
  goal: string;
  spec?: {
    platform?: string;
    duration_seconds?: { min?: number; max?: number };
    captions?: boolean;
    look?: string;
  };
};

type HandoffStatus = {
  pending_count?: number;
  git_configured?: boolean;
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

const defaultDraft = {
  title: '',
  goal: '',
  platform: 'reels_tiktok_shorts',
  min: '12',
  max: '20',
  captions: true,
  look: '',
  must_keep: '',
  must_drop: '',
};

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
  const [draft, setDraft] = useState(defaultDraft);
  const [brief, setBrief] = useState('');
  const [activeSpecId, setActiveSpecId] = useState('');
  const [saving, setSaving] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const waiting = useMemo(() => specs.filter((item) => item.status === 'waiting_for_bot'), [specs]);
  const received = useMemo(() => specs.filter((item) => item.status === 'received'), [specs]);

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
        body: JSON.stringify({ demo, edit_spec_id: activeSpecId || waiting[0]?.id || '' }),
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
        setError(t('아직 봇이 넘긴 폴더가 없습니다. 글을 복사해 다른 컴퓨터의 Grok에게 주세요.', 'No bot package yet. Copy the brief and give it to Grok on another computer.', '还没有机器人包。请复制说明并交给另一台电脑上的 Grok。', 'ボットの包はまだありません。文をコピーして別のパソコンの Grok に渡してください。'));
      }
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
        <h1>{t('규격만 적으면, 봇이 영상과 편집을 넘깁니다', 'You write the brief. The bot brings the footage and the cut.', '你只写规格。机器人送来素材和剪辑。', '仕様だけ書く。映像と編集はボットが渡す。')}</h1>
        <p>{t('원본은 이 컴퓨터에 두지 않아도 됩니다. 다른 컴퓨터의 Grok이 소스와 컷을 만들어 인계 폴더로 보냅니다. 이 PC는 받아서 보여 줍니다.', 'You do not have to drop a file here. Grok on another computer makes the source and the cut, then hands the folder over. This PC only receives it.', '不必把原片放在这台电脑。另一台电脑上的 Grok 会做好素材和剪辑再交过来。这台电脑只负责接收。', '原版をこのパソコンに置かなくて大丈夫です。別のパソコンの Grok が素材とカットを作り、このPCは受け取るだけです。')}</p>
      </div>

      <form className="desktop-spec-form" onSubmit={(event) => { event.preventDefault(); void saveSpec(); }}>
        <label>
          <span>{t('제목', 'Title', '标题', 'タイトル')}</span>
          <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder={t('15초 훅 릴', '15s hook Reel', '15秒钩子 Reel', '15秒フックのリール')} required />
        </label>
        <label className="desktop-spec-wide">
          <span>{t('어떻게 만들까', 'How should it feel', '做成什么样', 'どう作るか')}</span>
          <textarea value={draft.goal} onChange={(event) => setDraft({ ...draft, goal: event.target.value })} placeholder={t('가장 센 대사만 남긴 세로 숏폼. 첫 2초에 훅.', 'A vertical short that keeps only the strongest lines. Hook in the first two seconds.', '只留最有力的几句，竖屏短视频。前两秒要有钩子。', '一番強いセリフだけ残した縦型ショート。最初の2秒でフック。')} rows={3} required />
        </label>
        <div className="desktop-spec-row">
          <label>
            <span>{t('형태', 'Shape', '形态', '形')}</span>
            <select value={draft.platform} onChange={(event) => setDraft({ ...draft, platform: event.target.value })}>
              <option value="reels_tiktok_shorts">9:16 Reels / TikTok / Shorts</option>
              <option value="feed_square">1:1 {t('피드', 'Feed', '信息流', 'フィード')}</option>
              <option value="landscape">16:9</option>
            </select>
          </label>
          <label>
            <span>{t('최소 초', 'Min seconds', '最短秒数', '最短秒')}</span>
            <input type="number" min={1} max={180} value={draft.min} onChange={(event) => setDraft({ ...draft, min: event.target.value })} />
          </label>
          <label>
            <span>{t('최대 초', 'Max seconds', '最长秒数', '最長秒')}</span>
            <input type="number" min={1} max={180} value={draft.max} onChange={(event) => setDraft({ ...draft, max: event.target.value })} />
          </label>
        </div>
        <label className="desktop-spec-check">
          <input type="checkbox" checked={draft.captions} onChange={(event) => setDraft({ ...draft, captions: event.target.checked })} />
          <span>{t('자막 넣기', 'Burn in captions', '烧录字幕', '字幕を入れる')}</span>
        </label>
        <label>
          <span>{t('분위기', 'Look', '风格', '雰囲気')}</span>
          <input value={draft.look} onChange={(event) => setDraft({ ...draft, look: event.target.value })} placeholder={t('자연스럽게, 너무 과하지 않게', 'Natural, not too processed', '自然，不要太过', '自然に、加工しすぎない')} />
        </label>
        <label>
          <span>{t('꼭 남길 것', 'Must keep', '必须留下', '必ず残す')}</span>
          <input value={draft.must_keep} onChange={(event) => setDraft({ ...draft, must_keep: event.target.value })} />
        </label>
        <label>
          <span>{t('버릴 것', 'Must drop', '必须去掉', '捨てるもの')}</span>
          <input value={draft.must_drop} onChange={(event) => setDraft({ ...draft, must_drop: event.target.value })} />
        </label>
        <div className="desktop-spec-actions">
          <button type="submit" className="desktop-primary" disabled={locked}>{saving ? t('저장 중…', 'Saving…', '保存中…', '保存中…') : t('규격 저장하고 봇에게 보낼 글 만들기', 'Save the brief for the bot', '保存规格并生成给机器人的说明', '仕様を保存してボット用の文を作る')}</button>
        </div>
      </form>

      {brief ? (
        <section className="desktop-spec-brief">
          <div className="desktop-card-title"><span>02</span><div><b>{t('다른 컴퓨터의 Grok에게 이 글을 주세요', 'Give this text to Grok on another computer', '把这段话交给另一台电脑上的 Grok', '別のパソコンの Grok にこの文を渡す')}</b><small>{t('원본 파일은 보내지 않습니다. 봇이 소스와 컷을 만듭니다.', 'Do not send a source file. The bot makes the footage and the cut.', '不要发送原片。机器人会做素材和剪辑。', '原版は送らない。素材とカットはボットが作る。')}</small></div></div>
          <textarea readOnly value={brief} rows={10} />
          <div className="desktop-spec-actions">
            <button type="button" className="desktop-primary" onClick={() => void copyBrief()}>{copied ? t('복사됨', 'Copied', '已复制', 'コピー済み') : t('글 복사', 'Copy the brief', '复制说明', '文をコピー')}</button>
            <button type="button" className="desktop-secondary" disabled={locked} onClick={() => void receiveBotCut(false)}>{t('봇이 넘긴 편집 받기', 'Receive the bot cut', '接收机器人剪辑', 'ボットの編集を受け取る')}</button>
            <button type="button" className="desktop-secondary" disabled={locked} onClick={() => void receiveBotCut(true)}>{t('예시로 어떻게 도착하는지 보기', 'See a sample delivery', '查看示例如何送达', '届き方の例を見る')}</button>
          </div>
        </section>
      ) : (
        <div className="desktop-spec-actions">
          <button type="button" className="desktop-secondary" disabled={locked} onClick={() => void receiveBotCut(false)}>{t('봇이 넘긴 편집 받기', 'Receive the bot cut', '接收机器人剪辑', 'ボットの編集を受け取る')}</button>
          <button type="button" className="desktop-secondary" disabled={locked} onClick={() => void receiveBotCut(true)}>{t('예시로 어떻게 도착하는지 보기', 'See a sample delivery', '查看示例如何送达', '届き方の例を見る')}</button>
        </div>
      )}

      {error ? <p className="desktop-spec-error" role="alert">{error}</p> : null}

      <p className="desktop-spec-meta">
        {t(`대기 중인 규격 ${waiting.length}개 · 받은 컷 ${received.length}개`, `${waiting.length} briefs waiting · ${received.length} cuts received`, `等待中的规格 ${waiting.length} · 已收到 ${received.length}`, `待ちの仕様 ${waiting.length} · 受け取ったカット ${received.length}`)}
        {handoff?.pending_count ? ` · ${t(`받은 폴더 ${handoff.pending_count}`, `${handoff.pending_count} folders waiting`, `待收文件夹 ${handoff.pending_count}`, `待ちフォルダ ${handoff.pending_count}`)}` : ''}
        {handoff?.git_configured ? ` · ${t('git 인계 연결됨', 'git handoff is set', '已设置 git 交接', 'git 引き継ぎ設定済み')}` : ''}
      </p>

      <details className="desktop-spec-advanced">
        <summary>{t('이 컴퓨터에 이미 있는 영상으로 직접 열기', 'Open a file that is already on this computer', '直接打开这台电脑上已有的视频', 'このパソコンにある映像を自分で開く')}</summary>
        <div className="desktop-empty-actions">
          {sampleAvailable ? <button type="button" className="desktop-secondary" disabled={locked} onClick={onOpenSample}>{t('화면 확인용 샘플', 'Preview sample', '预览示例', '画面確認用サンプル')}</button> : null}
          <button type="button" className="desktop-secondary" disabled={locked} onClick={onOpenOwnFootage}>{t('내 파일 열기', 'Open my file', '打开我的文件', '自分のファイルを開く')}</button>
        </div>
      </details>
    </div>
  );
}
