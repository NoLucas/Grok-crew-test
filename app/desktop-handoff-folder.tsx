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

function FilePeek({ file }: { file: HandoffFolderFile }) {
  if (file.kind === 'image') {
    // Loopback sidecar still of a workspace-relative file.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={mediaUrl(file.path)} alt="" />;
  }
  if (file.kind === 'video') {
    return <video muted playsInline preload="metadata" src={mediaUrl(file.path)} />;
  }
  return <span>{file.kind === 'audio' ? '♪' : '·'}</span>;
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

  const toggleFile = (folderId: string, path: string) => {
    setSelected((current) => {
      if (current[folderId] === path) {
        const next = { ...current };
        delete next[folderId];
        return next;
      }
      return { ...current, [folderId]: path };
    });
  };

  if (studioState === 'loading' && !visible.length && expectEmpty) {
    return (
      <section className={`desktop-handoff-board${compact ? ' is-compact' : ''}`} aria-busy="true">
        <div className="desktop-handoff-state">
          <span className="desktop-spinner" />
          <p>{t('저장된 폴더를 읽는 중', 'Reading the saved folder', '正在读取保存的文件夹', '保存フォルダを読み込み中')}</p>
        </div>
      </section>
    );
  }

  if (studioState === 'error' && expectEmpty) {
    return (
      <section className={`desktop-handoff-board${compact ? ' is-compact' : ''}`}>
        <div className="desktop-handoff-state is-error" role="alert">
          <span>!</span>
          <p>{t('폴더를 읽지 못했습니다. Local Studio가 켜져 있는지 보세요.', 'Could not read the folder. Check that Local Studio is on.', '无法读取文件夹。请确认 Local Studio 已打开。', 'フォルダを読めません。Local Studio が起動しているか見てください。')}</p>
        </div>
      </section>
    );
  }

  if (!visible.length && expectEmpty) {
    return (
      <section className={`desktop-handoff-board${compact ? ' is-compact' : ''}`}>
        <div className="desktop-handoff-state">
          <span>○</span>
          <p>{t('아직 이 폴더에 파일이 없습니다.', 'This folder has no files yet.', '这个文件夹里还没有文件。', 'このフォルダにファイルはまだありません。')}</p>
        </div>
      </section>
    );
  }

  if (!visible.length) return null;

  return (
    <section className={`desktop-handoff-board${compact ? ' is-compact' : ''}`} aria-label={t('봇이 가져온 파일', 'Files the bot brought', '机器人带来的文件', 'ボットが持ってきたファイル')}>
      {visible.map((folder) => {
        const count = folder.file_count ?? folder.files.length;
        const current = folder.files.find((item) => item.path === selected[folder.id]);
        const preview = current ? mediaUrl(current.path) : '';
        const heading = folder.kind === 'materials'
          ? t('자료함에 저장된 파일', 'Files in the materials box', '资料箱里的文件', '素材箱に保存されたファイル')
          : t('봇이 가져온 파일', 'Files the bot brought', '机器人带来的文件', 'ボットが持ってきたファイル');
        return (
          <details key={`${folder.kind}:${folder.id}`} className={`desktop-handoff-folder ${folder.kind === 'materials' ? 'is-materials' : 'is-package'}`}>
            <summary className="desktop-handoff-summary">
              <span className="desktop-handoff-mark" aria-hidden="true" />
              <span className="desktop-handoff-icon" aria-hidden="true">{folder.kind === 'materials' ? '▣' : '▶'}</span>
              <div>
                <b>{heading}</b>
                <small>{doorLabel(folder, t)} · {count} {t('개', 'files', '个', '個')}{folder.title ? ` · ${folder.title}` : ''}</small>
              </div>
              <div className="desktop-handoff-peeks" aria-hidden="true">
                {folder.files.slice(0, 3).map((file) => (
                  <i key={file.path} className={`is-${file.kind}`}><FilePeek file={file} /></i>
                ))}
              </div>
              <em className="desktop-handoff-toggle">
                <span className="is-closed">{t('펼쳐 보기', 'Open', '展开', '開く')}</span>
                <span className="is-open">{t('접기', 'Close', '收起', '閉じる')}</span>
              </em>
              {folder.project_id && onOpenProject ? (
                <button
                  type="button"
                  className="desktop-secondary"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onOpenProject(folder.project_id as string);
                  }}
                >
                  {t('타임라인 열기', 'Open timeline', '打开时间线', 'タイムラインを開く')}
                </button>
              ) : null}
            </summary>
            <div className="desktop-handoff-body">
              <p className="desktop-handoff-path">{folder.relative_dir}</p>
              {folder.notes ? <p className="desktop-handoff-notes">{folder.notes}</p> : null}
              <ul className="desktop-handoff-list">
                {folder.files.map((item) => (
                  <li key={item.path}>
                    <button
                      type="button"
                      className={item.path === current?.path ? 'desktop-handoff-row is-selected' : 'desktop-handoff-row'}
                      aria-pressed={item.path === current?.path}
                      onClick={() => toggleFile(folder.id, item.path)}
                    >
                      <span className={`desktop-handoff-mini is-${item.kind}`}>
                        <FilePeek file={item} />
                      </span>
                      <span>
                        <b>{item.name}</b>
                        <small>
                          {roleLabel(item.role, t)} · {formatBytes(item.size_bytes)}
                          {item.note ? ` · ${item.note}` : ''}
                          {item.license === 'unknown' ? ` · ${t('출처 불명', 'Unknown license', '来源不明', '出典不明')}` : ''}
                        </small>
                      </span>
                      <em>{item.path === current?.path
                        ? t('미리보기 닫기', 'Hide preview', '收起预览', 'プレビューを閉じる')
                        : t('미리보기', 'Preview', '预览', 'プレビュー')}</em>
                    </button>
                  </li>
                ))}
              </ul>
              {current ? (
                <div className="desktop-handoff-preview">
                  {current.kind === 'video' ? <video key={current.path} controls preload="metadata" src={preview} /> : null}
                  {current.kind === 'audio' ? <audio key={current.path} controls preload="metadata" src={preview} /> : null}
                  {current.kind === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={current.path} src={preview} alt={current.name} />
                  ) : null}
                  <p>{t(`${current.name} · 이 PC 폴더의 원본입니다.`, `${current.name} · original on this PC.`, `${current.name} · 这是这台电脑文件夹里的原片。`, `${current.name} · このPCフォルダの原本です。`)}</p>
                </div>
              ) : (
                <p className="desktop-handoff-hint">{t('파일을 누르면 여기서 미리봅니다.', 'Tap a file to preview it here.', '点文件即可在此预览。', 'ファイルを押すとここでプレビューします。')}</p>
              )}
            </div>
          </details>
        );
      })}
    </section>
  );
}
