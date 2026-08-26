'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
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

type StudioRequest = (path: string, init?: RequestInit) => Promise<unknown>;

type HandoffFolderBoardProps = {
  folders: HandoffFolder[];
  studioState?: StudioState;
  compact?: boolean;
  expectEmpty?: boolean;
  onOpenProject?: (projectId: string) => void;
  request?: StudioRequest;
  onRefresh?: () => void | Promise<void>;
  protectedPaths?: string[];
  onMessage?: (text: string) => void;
};

type MenuState = {
  folderId: string;
  file: HandoffFolderFile;
  x: number;
  y: number;
};

function studioBase() {
  return typeof window !== 'undefined' && window.grokCrew?.apiBase ? window.grokCrew.apiBase : 'http://127.0.0.1:7214';
}

function mediaUrl(path: string) {
  return `${studioBase()}/media/${path.replaceAll('\\', '/').split('/').map(encodeURIComponent).join('/')}`;
}

function normalizePath(path: string) {
  return path.replaceAll('\\', '/').replace(/^\.?\//, '');
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

function FilePlayer({ file, large = false }: { file: HandoffFolderFile; large?: boolean }) {
  const src = mediaUrl(file.path);
  if (file.kind === 'video') {
    return <video key={file.path} controls autoPlay={large} preload="metadata" src={src} />;
  }
  if (file.kind === 'audio') {
    return <audio key={file.path} controls autoPlay={large} preload="metadata" src={src} />;
  }
  if (file.kind === 'image') {
    // eslint-disable-next-line @next/next/no-img-element
    return <img key={file.path} src={src} alt={file.name} />;
  }
  return null;
}

export function HandoffFolderBoard({
  folders,
  studioState = 'ready',
  compact = false,
  expectEmpty = false,
  onOpenProject,
  request,
  onRefresh,
  protectedPaths = [],
  onMessage,
}: HandoffFolderBoardProps) {
  const { t } = useLanguage();
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState('');
  const [lightbox, setLightbox] = useState<HandoffFolderFile | null>(null);
  const [busyPath, setBusyPath] = useState('');
  const menuRef = useRef<HTMLDivElement | null>(null);
  const protectedSet = useMemo(
    () => new Set(protectedPaths.map(normalizePath).filter(Boolean)),
    [protectedPaths],
  );

  const visible = useMemo(
    () => folders.filter((folder) => folder.files.length || folder.notes),
    [folders],
  );

  useEffect(() => {
    if (!menu && !lightbox) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenu(null);
        setConfirmDelete('');
        setLightbox(null);
      }
    };
    const onPointer = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenu(null);
        setConfirmDelete('');
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointer);
    };
  }, [menu, lightbox]);

  const isProtected = (file: HandoffFolderFile) => (
    file.role === 'source' || protectedSet.has(normalizePath(file.path))
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

  const previewFile = (folderId: string, file: HandoffFolderFile) => {
    setSelected((current) => ({ ...current, [folderId]: file.path }));
    setMenu(null);
    setConfirmDelete('');
  };

  const openMenu = (event: MouseEvent, folderId: string, file: HandoffFolderFile) => {
    event.preventDefault();
    event.stopPropagation();
    const pad = 8;
    const width = 220;
    const height = 196;
    const x = Math.min(event.clientX, window.innerWidth - width - pad);
    const y = Math.min(event.clientY, window.innerHeight - height - pad);
    setMenu({ folderId, file, x: Math.max(pad, x), y: Math.max(pad, y) });
    setConfirmDelete('');
  };

  const revealOriginal = async (file: HandoffFolderFile) => {
    setBusyPath(file.path);
    try {
      if (window.grokCrew?.showOutput) {
        try {
          await window.grokCrew.showOutput(file.path);
          onMessage?.(t(`${file.name} 원본 폴더를 열었습니다.`, `Opened the folder for ${file.name}.`, `已打开 ${file.name} 的原片文件夹。`, `${file.name} の原本フォルダを開きました。`));
          return;
        } catch {
          /* Fall through to the sidecar reveal so browser and mismatched workspace still work. */
        }
      }
      if (!request) {
        onMessage?.(t(`원본 경로: ${file.path}`, `Original path: ${file.path}`, `原片路径：${file.path}`, `原本パス: ${file.path}`));
        return;
      }
      const result = await request('/api/v2/handoff/files/reveal', {
        method: 'POST',
        body: JSON.stringify({ path: file.path }),
      }) as { absolute_path?: string; revealed?: boolean };
      const shown = result.absolute_path || file.path;
      onMessage?.(result.revealed
        ? t(`${file.name} 원본 폴더를 열었습니다.`, `Opened the folder for ${file.name}.`, `已打开 ${file.name} 的原片文件夹。`, `${file.name} の原本フォルダを開きました。`)
        : t(`원본 파일: ${shown}`, `Original file: ${shown}`, `原片文件：${shown}`, `原本ファイル: ${shown}`));
    } catch (error) {
      onMessage?.(error instanceof Error ? error.message : t('원본을 열지 못했습니다.', 'Could not open the original.', '无法打开原片。', '原本を開けませんでした。'));
    } finally {
      setBusyPath('');
      setMenu(null);
    }
  };

  const deleteFile = async (file: HandoffFolderFile) => {
    if (isProtected(file)) {
      onMessage?.(t('이 파일은 프로젝트 원본이라 지울 수 없습니다.', 'This file is the project source and cannot be deleted.', '这是项目原片，不能删除。', 'このファイルはプロジェクトの原本なので削除できません。'));
      setMenu(null);
      return;
    }
    if (confirmDelete !== file.path) {
      setConfirmDelete(file.path);
      return;
    }
    if (!request) {
      onMessage?.(t('이 화면에서는 삭제할 수 없습니다.', 'Delete is not available on this screen.', '此画面无法删除。', 'この画面では削除できません。'));
      return;
    }
    setBusyPath(file.path);
    try {
      await request('/api/v2/handoff/files/delete', {
        method: 'POST',
        body: JSON.stringify({ path: file.path }),
      });
      setSelected((current) => {
        const next = { ...current };
        for (const [folderId, path] of Object.entries(next)) {
          if (path === file.path) delete next[folderId];
        }
        return next;
      });
      if (lightbox?.path === file.path) setLightbox(null);
      onMessage?.(t(`${file.name}을 삭제했습니다.`, `Deleted ${file.name}.`, `已删除 ${file.name}。`, `${file.name} を削除しました。`));
      await onRefresh?.();
    } catch (error) {
      onMessage?.(error instanceof Error ? error.message : t('삭제하지 못했습니다.', 'Could not delete the file.', '无法删除文件。', '削除できませんでした。'));
    } finally {
      setBusyPath('');
      setMenu(null);
      setConfirmDelete('');
    }
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
              <p className="desktop-handoff-path">{folder.relative_dir} · {t('오른쪽 클릭으로 미리보기·삭제·크게 보기·원본', 'Right-click to preview, delete, enlarge, or open the original', '右键可预览、删除、放大或打开原片', '右クリックでプレビュー・削除・拡大・原本')}</p>
              {folder.notes ? <p className="desktop-handoff-notes">{folder.notes}</p> : null}
              <div className="desktop-handoff-open">
                <ul className="desktop-handoff-list">
                  {folder.files.map((item) => (
                    <li key={item.path}>
                      <div className={item.path === current?.path ? 'desktop-handoff-row is-selected' : 'desktop-handoff-row'}>
                        <button
                          type="button"
                          className="desktop-handoff-row-main"
                          aria-pressed={item.path === current?.path}
                          onClick={() => toggleFile(folder.id, item.path)}
                          onContextMenu={(event) => openMenu(event, folder.id, item)}
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
                              {isProtected(item) ? ` · ${t('삭제 잠금', 'Delete locked', '不可删除', '削除ロック')}` : ''}
                            </small>
                          </span>
                          <em>{item.path === current?.path
                            ? t('미리보기 닫기', 'Hide preview', '收起预览', 'プレビューを閉じる')
                            : t('미리보기', 'Preview', '预览', 'プレビュー')}</em>
                        </button>
                        <button
                          type="button"
                          className="desktop-handoff-more"
                          aria-label={t('파일 메뉴', 'File menu', '文件菜单', 'ファイルメニュー')}
                          onClick={(event) => openMenu(event, folder.id, item)}
                          onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              const box = event.currentTarget.getBoundingClientRect();
                              openMenu({
                                ...event,
                                preventDefault: () => event.preventDefault(),
                                stopPropagation: () => event.stopPropagation(),
                                clientX: box.left,
                                clientY: box.bottom,
                              } as unknown as MouseEvent, folder.id, item);
                            }
                          }}
                        >
                          ⋯
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                {current ? (
                  <div className="desktop-handoff-preview">
                    <FilePlayer file={current} />
                    <p>{t(`${current.name} · 이 PC 폴더의 원본입니다.`, `${current.name} · original on this PC.`, `${current.name} · 这是这台电脑文件夹里的原片。`, `${current.name} · このPCフォルダの原本です。`)}</p>
                  </div>
                ) : (
                  <p className="desktop-handoff-hint">{t('왼쪽은 목록, 오른쪽은 미리보기입니다. 오른쪽 클릭으로 고르세요.', 'List on the left, preview on the right. Right-click to choose.', '左侧是列表，右侧是预览。用右键选择。', '左が一覧、右がプレビュー。右クリックで選びます。')}</p>
                )}
              </div>
            </div>
          </details>
        );
      })}
      {menu ? (
        <div
          ref={menuRef}
          className="desktop-handoff-menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
        >
          <button type="button" role="menuitem" onClick={() => previewFile(menu.folderId, menu.file)}>
            {t('미리보기', 'Preview', '预览', 'プレビュー')}
          </button>
          <button type="button" role="menuitem" onClick={() => { setLightbox(menu.file); setMenu(null); }}>
            {t('크게 보기', 'View large', '放大查看', '大きく見る')}
          </button>
          <button type="button" role="menuitem" disabled={busyPath === menu.file.path} onClick={() => void revealOriginal(menu.file)}>
            {t('원본 파일 보기', 'Show original file', '查看原片', '原本ファイルを見る')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            disabled={isProtected(menu.file) || busyPath === menu.file.path}
            onClick={() => void deleteFile(menu.file)}
          >
            {isProtected(menu.file)
              ? t('원본은 삭제 불가', 'Source cannot be deleted', '原片不可删除', '原本は削除不可')
              : confirmDelete === menu.file.path
                ? t('정말 삭제?', 'Delete for sure?', '确认删除？', '本当に削除？')
                : t('삭제', 'Delete', '删除', '削除')}
          </button>
        </div>
      ) : null}
      {lightbox ? (
        <div className="desktop-handoff-lightbox" role="dialog" aria-modal="true" aria-label={lightbox.name}>
          <button type="button" className="desktop-handoff-lightbox-backdrop" aria-label={t('닫기', 'Close', '关闭', '閉じる')} onClick={() => setLightbox(null)} />
          <div className="desktop-handoff-lightbox-card">
            <header>
              <div>
                <b>{lightbox.name}</b>
                <small>{t('프록시가 아닌 이 PC의 원본입니다.', 'This is the original on this PC, not a proxy.', '这是这台电脑上的原片，不是代理预览。', 'プロキシではなく、このPCの原本です。')}</small>
              </div>
              <button type="button" className="desktop-secondary" onClick={() => setLightbox(null)}>{t('닫기', 'Close', '关闭', '閉じる')}</button>
            </header>
            <FilePlayer file={lightbox} large />
          </div>
        </div>
      ) : null}
    </section>
  );
}
