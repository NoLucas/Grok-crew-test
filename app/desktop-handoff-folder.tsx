'use client';

import { useMemo, useState } from 'react';
import { useLanguage } from './language';

export type HandoffFolderFile = {
  name: string;
  path: string;
  kind: 'video' | 'audio' | 'image' | string;
  size_bytes: number;
  role?: 'source' | 'broll' | 'clip' | string;
  note?: string;
  origin?: string;
  license?: string;
};

export type HandoffFolder = {
  kind: 'package' | 'materials' | string;
  id: string;
  relative_dir: string;
  title?: string;
  agent?: string;
  door?: string;
  project_id?: string | null;
  spec_id?: string | null;
  notes?: string;
  updated_at?: string;
  file_count?: number;
  files: HandoffFolderFile[];
};

type StudioState = 'loading' | 'ready' | 'error';

type HandoffFolderBoardProps = {
  folders: HandoffFolder[];
  studioState?: StudioState;
  compact?: boolean;
  expectEmpty?: boolean;
  onOpenProject?: (projectId: string) => void;
};

function studioBase() {
  return typeof window !== 'undefined' && window.grokCrew?.apiBase ? window.grokCrew.apiBase : 'http://127.0.0.1:7214';
}

function mediaUrl(path: string) {
  return `${studioBase()}/media/${path.replaceAll('\\', '/').split('/').map(encodeURIComponent).join('/')}`;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function roleLabel(
  role: string | undefined,
  t: (ko: string, en: string, zh: string, ja: string) => string,
) {
  if (role === 'source') return t('원본', 'Source', '原片', '原本');
  if (role === 'broll') return 'B-roll';
  return t('자료', 'Clip', '素材', '素材');
}

function doorLabel(
  folder: HandoffFolder,
  t: (ko: string, en: string, zh: string, ja: string) => string,
) {
  if (folder.kind === 'materials' || folder.door === 'collector' || folder.door === 'agent') {
    return t('수집 Agent', 'Collector Agent', '收集 Agent', '収集 Agent');
  }
  return t('편집 Agent', 'Editor Agent', '剪辑 Agent', '編集 Agent');
}

export function HandoffFolderBoard({
  folders,
  studioState = 'ready',
  compact = false,
  expectEmpty = false,
  onOpenProject,
}: HandoffFolderBoardProps) {
  const { t } = useLanguage();
  const [selected, setSelected] = useState<Record<string, string>>({});

  const visible = useMemo(
    () => folders.filter((folder) => folder.files.length || folder.notes),
    [folders],
  );

  if (studioState === 'loading' && !visible.length && expectEmpty) {
    return (
      <section className={`desktop-handoff-board${compact ? ' is-compact' : ''}`} aria-busy="true">
        <div className="desktop-handoff-state">
          <span className="desktop-spinner" />
          <div>
            <b>{t('저장된 폴더를 읽는 중', 'Reading the saved folder', '正在读取保存的文件夹', '保存フォルダを読み込み中')}</b>
            <p>{t('봇이 넘긴 파일이 이 PC에 있으면 여기에 나타납니다.', 'Files the bot saved on this PC appear here.', '机器人保存在这台电脑上的文件会显示在这里。', 'ボットがこのPCに残したファイルがここに出ます。')}</p>
          </div>
        </div>
      </section>
    );
  }

  if (studioState === 'error' && expectEmpty) {
    return (
      <section className={`desktop-handoff-board${compact ? ' is-compact' : ''}`}>
        <div className="desktop-handoff-state is-error" role="alert">
          <span>!</span>
          <div>
            <b>{t('폴더를 읽지 못했습니다', 'Could not read the folder', '无法读取文件夹', 'フォルダを読めませんでした')}</b>
            <p>{t('Local Studio가 꺼져 있으면 저장된 파일을 보여 줄 수 없습니다.', 'The saved files stay hidden while Local Studio is off.', 'Local Studio 关闭时无法显示已保存的文件。', 'Local Studio が止まっていると保存ファイルを見せられません。')}</p>
          </div>
        </div>
      </section>
    );
  }

  if (!visible.length && expectEmpty) {
    return (
      <section className={`desktop-handoff-board${compact ? ' is-compact' : ''}`}>
        <div className="desktop-handoff-state">
          <span>○</span>
          <div>
            <b>{t('아직 이 폴더에 파일이 없습니다', 'This folder has no files yet', '这个文件夹里还没有文件', 'このフォルダにファイルはまだありません')}</b>
            <p>{t('봇이 편집할 영상을 넘기면 여기에 이름과 미리보기가 생깁니다.', 'When the bot drops footage to edit, names and previews land here.', '机器人交来要剪的影像后，这里会出现名称和预览。', 'ボットが編集用の映像を渡すと、名前とプレビューがここに出ます。')}</p>
          </div>
        </div>
      </section>
    );
  }

  if (!visible.length) return null;

  return (
    <section className={`desktop-handoff-board${compact ? ' is-compact' : ''}`} aria-label={t('봇이 가져온 파일', 'Files the bot brought', '机器人带来的文件', 'ボットが持ってきたファイル')}>
      {visible.map((folder) => {
        const selectedPath = selected[folder.id] || folder.files[0]?.path || '';
        const current = folder.files.find((item) => item.path === selectedPath) ?? folder.files[0];
        const preview = current ? mediaUrl(current.path) : '';
        return (
          <article key={`${folder.kind}:${folder.id}`} className={`desktop-handoff-folder ${folder.kind === 'materials' ? 'is-materials' : 'is-package'}`}>
            <div className="desktop-handoff-folder-head">
              <span aria-hidden="true">{folder.kind === 'materials' ? '▣' : '▶'}</span>
              <div>
                <b>{folder.kind === 'materials'
                  ? t('자료함에 저장된 파일', 'Files in the materials box', '资料箱里的文件', '素材箱に保存されたファイル')
                  : t('봇이 가져온 파일', 'Files the bot brought', '机器人带来的文件', 'ボットが持ってきたファイル')}</b>
                <small>{doorLabel(folder, t)} · {folder.file_count ?? folder.files.length} {t('개', 'files', '个', '個')} · {folder.relative_dir}</small>
                {folder.title ? <p>{folder.title}</p> : null}
              </div>
              {folder.project_id && onOpenProject ? (
                <button type="button" className="desktop-secondary" onClick={() => onOpenProject(folder.project_id as string)}>
                  {t('타임라인 열기', 'Open timeline', '打开时间线', 'タイムラインを開く')}
                </button>
              ) : null}
            </div>
            {folder.notes ? <p className="desktop-handoff-notes">{folder.notes}</p> : null}
            <div className="desktop-handoff-grid">
              {folder.files.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  className={item.path === current?.path ? 'desktop-handoff-tile is-selected' : 'desktop-handoff-tile'}
                  aria-pressed={item.path === current?.path}
                  title={item.name}
                  onClick={() => setSelected((value) => ({ ...value, [folder.id]: item.path }))}
                >
                  <div className={`desktop-handoff-thumb is-${item.kind}`}>
                    {item.kind === 'image' ? (
                      // Loopback sidecar preview of a workspace-relative still.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={mediaUrl(item.path)} alt="" />
                    ) : item.kind === 'video' ? (
                      <video muted playsInline preload="metadata" src={mediaUrl(item.path)} />
                    ) : (
                      <span>{item.kind === 'audio' ? '♪' : '·'}</span>
                    )}
                    <i>{roleLabel(item.role, t)}</i>
                  </div>
                  <div className="desktop-handoff-caption">
                    <b>{item.name}</b>
                    <small>{formatBytes(item.size_bytes)}{item.note ? ` · ${item.note}` : ''}</small>
                    {item.license === 'unknown' ? <em className="is-warn">{t('출처 불명', 'Unknown license', '来源不明', '出典不明')}</em> : null}
                  </div>
                </button>
              ))}
            </div>
            {!compact && current ? (
              <div className="desktop-handoff-preview">
                {current.kind === 'video' ? <video controls preload="metadata" src={preview} /> : null}
                {current.kind === 'audio' ? <audio controls preload="metadata" src={preview} /> : null}
                {current.kind === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview} alt={current.name} />
                ) : null}
                <p>
                  {t(`${current.name} · 원본은 이 PC 폴더에 그대로 있습니다.`, `${current.name} · the original stays in this PC folder.`, `${current.name} · 原片仍留在这台电脑的文件夹里。`, `${current.name} · 原本はこのPCのフォルダに残る。`)}
                </p>
              </div>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
