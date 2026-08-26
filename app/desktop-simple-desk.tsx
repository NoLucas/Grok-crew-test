'use client';

import { useMemo, useState, type DragEvent } from 'react';
import { useLanguage } from './language';

type StyleRecipe = {
  id: string;
  name?: { ko?: string; en?: string; zh?: string; ja?: string };
};

type JsonObject = Record<string, unknown>;

type SimpleDeskProps = {
  recipes?: StyleRecipe[];
  busy: boolean;
  studioReady: boolean;
  sampleAvailable: boolean;
  onOpenSample: () => void;
  onOpenOwnFootage: () => void;
  onPickedFile?: (path: string) => void;
  onOpenAdvanced: () => void;
  onRefresh: () => Promise<void>;
  request: (path: string, init?: RequestInit) => Promise<JsonObject>;
};

const RECIPE_ORDER = ['instagram_reel', 'tiktok_tight', 'youtube_short', 'youtube_long'] as const;

function localized(map: { ko?: string; en?: string; zh?: string; ja?: string } | undefined, language: string, fallback: string) {
  if (!map) return fallback;
  const key = language.slice(0, 2) as 'ko' | 'en' | 'zh' | 'ja';
  return map[key] || map.en || fallback;
}

export function SimpleDesk({
  recipes = [],
  busy,
  studioReady,
  sampleAvailable,
  onOpenSample,
  onOpenOwnFootage,
  onPickedFile,
  onOpenAdvanced,
  onRefresh,
  request,
}: SimpleDeskProps) {
  const { language, t } = useLanguage();
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [recipeId, setRecipeId] = useState('instagram_reel');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const cards = useMemo(() => {
    const byId = new Map(recipes.map((item) => [item.id, item]));
    return RECIPE_ORDER.map((id) => byId.get(id)).filter((item): item is StyleRecipe => Boolean(item));
  }, [recipes]);

  const selected = cards.find((item) => item.id === recipeId) || cards[0];
  const locked = busy || saving || !studioReady;

  const copyInvite = async () => {
    const heading = title.trim();
    if (!heading) {
      setError(t('제목을 적어 주세요.', 'Write a title first.', '请先写标题。', '先にタイトルを書いてください。'));
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const created = await request('/api/v2/edit-specs', {
        method: 'POST',
        body: JSON.stringify({
          title: heading,
          goal: goal.trim() || heading,
          recipe_id: recipeId,
          source_mode: 'bot',
          language,
          upload: false,
        }),
      });
      const record = created.edit_spec as { id?: string };
      if (!record?.id) throw new Error(t('규격을 저장하지 못했습니다.', 'Could not save the spec.', '无法保存规格。', '仕様を保存できませんでした。'));
      const invite = await request(`/api/v2/edit-specs/${record.id}/invite?lang=${encodeURIComponent(language)}`);
      const text = String(invite.text || '');
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
      setNotice(t('봇 창에 붙여 넣으세요. 한 봇이 원본과 컷을 만듭니다.', 'Paste it in the bot. One bot makes the source and the cut.', '请粘贴到机器人窗口。一个机器人做原片和剪辑。', 'ボットの窓に貼ってください。一人のボットが素材とカットを作ります。'));
      await onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('복사하지 못했습니다.', 'Could not copy.', '无法复制。', 'コピーできませんでした。'));
    } finally {
      setSaving(false);
    }
  };

  const takeDropped = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0] as (File & { path?: string }) | undefined;
    if (file?.path && onPickedFile) {
      onPickedFile(file.path);
      return;
    }
    onOpenOwnFootage();
  };

  const pickFile = async () => {
    const picker = typeof window !== 'undefined' ? window.grokCrew?.selectMedia : undefined;
    if (!picker) {
      onOpenOwnFootage();
      return;
    }
    const picked = await picker();
    if (picked && onPickedFile) onPickedFile(picked);
    else if (picked) onOpenOwnFootage();
  };

  return (
    <div className="desktop-spec-desk desktop-simple-desk">
      <div className="desktop-spec-hero">
        <span>✦</span>
        <h1>{t('제목을 적거나 영상을 놓으세요', 'Write a title or drop a video', '写下标题，或放进视频', 'タイトルを書くか、映像を置く')}</h1>
        <p>{t('스타일은 인스타 릴입니다. 봇에게 한 줄을 복사하면 그 봇이 원본과 첫 컷을 만듭니다.', 'The style is an Instagram Reel. Copy one line to a bot. That bot makes the source and the first cut.', '默认是 Instagram Reel。复制一行给机器人，由它做原片和初剪。', 'スタイルは Instagram リール。一行をボットにコピーすると、そのボットが素材と初回カットを作る。')}</p>
      </div>

      <form
        className="desktop-spec-form"
        onSubmit={(event) => {
          event.preventDefault();
          void copyInvite();
        }}
      >
        <label className="desktop-spec-field">
          <span>{t('제목', 'Title', '标题', 'タイトル')}</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t('15초 훅 릴', '15s hook Reel', '15秒钩子 Reel', '15秒フックのリール')}
            required
          />
        </label>
        <label className="desktop-spec-field desktop-spec-wide">
          <span>{t('무엇을 말할까', 'What should it say', '要讲什么', '何を言うか')}</span>
          <textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder={t('비워 두면 제목과 같습니다.', 'Leave empty to use the title.', '留空则与标题相同。', '空ならタイトルと同じ。')}
            rows={3}
          />
        </label>

        <p className="desktop-spec-meta">
          {selected
            ? t(`${localized(selected.name, language, selected.id)} · 다른 스타일은 아래에서`, `${localized(selected.name, language, selected.id)} · more styles below`, `${localized(selected.name, language, selected.id)} · 下面可换风格`, `${localized(selected.name, language, selected.id)} · 他のスタイルは下`)
            : t('인스타 릴', 'Instagram Reel', 'Instagram Reel', 'Instagram リール')}
        </p>

        <details className="desktop-spec-advanced">
          <summary>{t('다른 스타일', 'Another style', '换风格', '他のスタイル')}</summary>
          <div className="desktop-spec-recipe-grid">
            {cards.map((recipe) => (
              <button
                key={recipe.id}
                type="button"
                className={recipe.id === recipeId ? 'desktop-spec-recipe is-selected' : 'desktop-spec-recipe'}
                aria-pressed={recipe.id === recipeId}
                onClick={() => setRecipeId(recipe.id)}
              >
                <b>{localized(recipe.name, language, recipe.id)}</b>
              </button>
            ))}
          </div>
        </details>

        <div className="desktop-spec-actions">
          <button type="submit" className="desktop-primary" disabled={locked}>
            {saving
              ? t('저장 중…', 'Saving…', '保存中…', '保存中…')
              : copied
                ? t('복사됨. 봇 창에 붙여 넣으세요', 'Copied. Paste it in the bot.', '已复制。请粘贴到机器人。', 'コピー済み。ボットに貼ってください')
                : t('봇에게 이 말 복사', 'Copy this for the bot', '复制给机器人', 'ボットにこの文をコピー')}
          </button>
        </div>
      </form>

      <button
        type="button"
        className="desktop-simple-drop"
        disabled={locked}
        onClick={() => void pickFile()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={takeDropped}
      >
        <b>{t('영상을 여기 놓거나 고르기', 'Drop a video here, or pick one', '把视频放这里，或选择', '映像をここに置くか選ぶ')}</b>
        <span>{t('내 파일이면 봇 없이 타임라인이 열립니다.', 'Your file opens on the timeline. No bot.', '自己的文件会直接打开时间线。不用机器人。', '自分のファイルならボットなしでタイムラインが開く。')}</span>
      </button>

      <div className="desktop-empty-actions">
        {sampleAvailable ? (
          <button type="button" className="desktop-secondary" disabled={busy || !studioReady} onClick={onOpenSample}>
            {t('샘플로 화면 보기', 'See it with the sample', '用示例查看画面', 'サンプルで画面を見る')}
          </button>
        ) : null}
        <button type="button" className="desktop-secondary" onClick={onOpenAdvanced}>
          {t('더 자세히', 'More detail', '更详细', 'もっと詳しく')}
        </button>
      </div>

      {notice ? <p className="desktop-spec-outbox" role="status">{notice}</p> : null}
      {error ? <p className="desktop-spec-error" role="alert">{error}</p> : null}

      <details className="desktop-spec-advanced">
        <summary>{t('안 열리면', 'If it will not open', '打不开时', '開かないとき')}</summary>
        <ol className="desktop-simple-help">
          <li>{t('받은 파일은 GrokCrew-Windows.exe 하나입니다.', 'The file you received is GrokCrew-Windows.exe.', '你收到的文件是 GrokCrew-Windows.exe。', '受け取ったファイルは GrokCrew-Windows.exe 一つ。')}</li>
          <li>{t('파란 “Windows의 PC 보호”가 뜨면 추가 정보 → 그래도 실행.', 'If you see “Windows protected your PC”, click More info → Run anyway.', '若出现“Windows 已保护你的电脑”，点“更多信息 → 仍要运行”。', '「Windows によって PC が保護されました」なら 詳細情報 → 実行。')}</li>
          <li>{t('그래도 안 되면 압축 실행 파일을 풀어 Grok Crew.exe 를 엽니다. 관리자 비밀번호는 필요 없습니다.', 'If it still will not open, unzip the portable file and open Grok Crew.exe. No administrator password.', '还是不行就解压便携包，打开 Grok Crew.exe。不需要管理员密码。', 'まだ開かないなら圧縮ファイルを解いて Grok Crew.exe を開く。管理者パスワードは不要。')}</li>
        </ol>
        <p className="desktop-simple-help">
          <a href="http://127.0.0.1:7214/downloads/grok-crew-bot.zip">
            {t('다른 방법: 봇에게 줄 파일', 'Other: file for the bot', '其他：给机器人的文件', '別の方法：ボット用ファイル')}
          </a>
        </p>
      </details>
    </div>
  );
}
