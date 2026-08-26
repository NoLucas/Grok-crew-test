'use client';

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState, type ReactNode } from 'react';
import { useLanguage } from '../language';
import { formatTimecode } from './geometry';

type PreviewPayload = {
  at: number;
  caption: string;
  image?: string;
  width?: number;
  height?: number;
  audio_rms?: number;
  active_clip_ids?: string[];
  error?: string;
};

type ScopePayload = {
  luma?: number[];
  parade?: { r: number[]; g: number[]; b: number[] };
};

export function ProgramMonitor({
  projectId,
  playhead,
  request,
  sourceFallback,
  previewOutput,
  outputReady,
  onToggleOutput,
  actions,
}: {
  projectId: string;
  playhead: number;
  request: (path: string) => Promise<Record<string, unknown>>;
  sourceFallback: string;
  previewOutput: boolean;
  outputReady: boolean;
  onToggleOutput: () => void;
  actions?: ReactNode;
}) {
  const { t } = useLanguage();
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [scopes, setScopes] = useState<ScopePayload | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (previewOutput) return;
    let cancelled = false;
    const handle = window.setTimeout(() => {
      setBusy(true);
      void request(`/api/v2/projects/${projectId}/preview?at=${playhead.toFixed(3)}`)
        .then((payload) => {
          if (cancelled) return;
          setPreview(payload.preview as PreviewPayload);
          setError('');
        })
        .catch((reason: unknown) => {
          if (!cancelled) setError(reason instanceof Error ? reason.message : 'Preview failed');
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [playhead, previewOutput, projectId, request]);

  const loadScopes = async () => {
    try {
      const payload = await request(`/api/v2/projects/${projectId}/scopes?at=${playhead.toFixed(3)}`);
      setScopes((payload.scopes as ScopePayload) ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Scopes failed');
    }
  };

  return (
    <section className="desktop-monitor">
      <div className="desktop-monitor-head">
        <span>{previewOutput ? t('렌더 결과', 'RENDERED OUTPUT', '渲染结果', 'レンダー結果') : t('프로그램 모니터', 'PROGRAM MONITOR', '节目监视器', 'プログラムモニター')}</span>
        <div className="desktop-monitor-actions">
          {actions}
          <button onClick={() => void loadScopes()}>{t('스코프', 'Scopes', '示波器', 'スコープ')}</button>
          {outputReady ? (
            <button className={previewOutput ? 'active' : ''} onClick={onToggleOutput}>
              {previewOutput ? t('합성 보기', 'View composite', '查看合成', '合成を見る') : t('결과 보기', 'View output', '查看结果', '出力を見る')}
            </button>
          ) : null}
        </div>
      </div>
      {previewOutput ? (
        <video key={sourceFallback} controls preload="metadata" src={sourceFallback} />
      ) : preview?.image ? (
        <img className="desktop-program-frame" alt={preview.caption || 'Program'} src={preview.image} />
      ) : (
        <div className="desktop-program-empty">
          {busy
            ? t('합성 미리보기를 만드는 중…', 'Compositing preview…', '正在合成预览…', '合成プレビューを作成中…')
            : error || t('플레이헤드에서 합성을 불러옵니다.', 'The playhead loads a composite frame.', '播放头会加载合成帧。', '再生位置の合成フレームを読み込みます。')}
        </div>
      )}
      <div className="desktop-monitor-foot">
        <span>{formatTimecode(playhead)}</span>
        <span>
          {preview?.width ? `${preview.width}×${preview.height}` : '—'}
          {preview?.caption ? ` · ${preview.caption}` : ''}
        </span>
        <span>
          {typeof preview?.audio_rms === 'number'
            ? `${t('오디오', 'Audio', '音频', 'オーディオ')} ${preview.audio_rms.toFixed(3)}`
            : t('최종 렌더: 원본', 'Final render: original', '最终渲染：原片', '最終レンダー: 元素材')}
        </span>
      </div>
      {scopes?.luma ? (
        <div className="desktop-scopes" aria-label="waveform">
          {scopes.luma.map((value, index) => (
            <i key={`luma-${index}`} style={{ height: `${Math.max(2, value / 2.55)}%` }} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
