'use client';

import { useLanguage } from '../language';
import type { TimelineClip, TimelineTrack } from './types';

export function ClipLookPanel({
  track,
  clip,
  onChange,
}: {
  track: TimelineTrack;
  clip: TimelineClip;
  onChange: (changes: Partial<TimelineClip>) => void;
}) {
  const { t } = useLanguage();
  if (!['video', 'overlay'].includes(track.type)) return null;
  const compositing = clip.compositing ?? {};
  const color = clip.color ?? {};
  const motion = clip.motion ?? {};
  return (
    <div className="desktop-look">
      <div className="desktop-inspector-head"><b>{t('합성·컬러·모션', 'Look', '合成/颜色/运动', '合成・カラー・モーション')}</b></div>
      <label>
        <span>{t('블렌드', 'Blend', '混合', 'ブレンド')}</span>
        <select
          value={compositing.blend_mode ?? 'normal'}
          onChange={(event) => onChange({ compositing: { ...compositing, blend_mode: event.target.value as NonNullable<typeof compositing.blend_mode> } })}
        >
          <option value="normal">Normal</option>
          <option value="multiply">Multiply</option>
          <option value="screen">Screen</option>
          <option value="overlay">Overlay</option>
          <option value="add">Add</option>
        </select>
      </label>
      <label>
        <span>{t('마스크', 'Mask', '遮罩', 'マスク')}</span>
        <select
          value={compositing.mask?.shape ?? 'none'}
          onChange={(event) => onChange({ compositing: { ...compositing, mask: { ...compositing.mask, shape: event.target.value as 'none' | 'rectangle' | 'ellipse' } } })}
        >
          <option value="none">{t('없음', 'None', '无', 'なし')}</option>
          <option value="rectangle">{t('사각형', 'Rectangle', '矩形', '矩形')}</option>
          <option value="ellipse">{t('타원', 'Ellipse', '椭圆', '楕円')}</option>
        </select>
      </label>
      <label>
        <span>{t('페더', 'Feather', '羽化', 'フェザー')}</span>
        <input
          type="number"
          min="0"
          max="1"
          step="0.05"
          value={compositing.mask?.feather ?? 0}
          onChange={(event) => onChange({ compositing: { ...compositing, mask: { ...compositing.mask, feather: Number(event.target.value) } } })}
        />
      </label>
      <label className="desktop-check">
        <input
          type="checkbox"
          checked={Boolean(compositing.chroma_key?.enabled)}
          onChange={(event) => onChange({ compositing: { ...compositing, chroma_key: { ...compositing.chroma_key, enabled: event.target.checked, color: compositing.chroma_key?.color ?? '#00FF00' } } })}
        />
        {t('크로마 키', 'Chroma key', '色度键', 'クロマキー')}
      </label>
      <label>
        <span>{t('채도', 'Saturation', '饱和度', '彩度')}</span>
        <input
          type="number"
          min="0"
          max="4"
          step="0.05"
          value={color.saturation ?? 1}
          onChange={(event) => onChange({ color: { ...color, saturation: Number(event.target.value) } })}
        />
      </label>
      <label className="desktop-check">
        <input
          type="checkbox"
          checked={Boolean(motion.stabilize)}
          onChange={(event) => onChange({ motion: { ...motion, stabilize: event.target.checked } })}
        />
        {t('안정화', 'Stabilize', '防抖', 'スタビライズ')}
      </label>
      <label className="desktop-check">
        <input
          type="checkbox"
          checked={Boolean(motion.speed_ramp?.enabled)}
          onChange={(event) => onChange({ motion: { ...motion, speed_ramp: { ...motion.speed_ramp, enabled: event.target.checked, ease: motion.speed_ramp?.ease ?? 'ease_in_out' } } })}
        />
        {t('스피드 램프', 'Speed ramp', '变速曲线', 'スピードランプ')}
      </label>
    </div>
  );
}
