'use client';

import { useState } from 'react';
import { useLanguage } from '../language';
import { clampTime, formatTimecode, roundTime } from './geometry';
import {
  KEYFRAME_LIMITS,
  buildRemoveKeyframeOperation,
  buildSetKeyframeOperation,
  keyframePropertiesForTrack,
  keyframeValue,
} from './keyframes';
import type { BuildResult, TimelineOperation } from './operations';
import type { ClipLocation, KeyframeProperty, Timeline } from './types';

const LABELS: Record<KeyframeProperty, [string, string, string, string]> = {
  x: ['가로 위치', 'Position X', '水平位置', 'X位置'],
  y: ['세로 위치', 'Position Y', '垂直位置', 'Y位置'],
  scale: ['크기', 'Scale', '缩放', 'スケール'],
  rotation: ['회전', 'Rotation', '旋转', '回転'],
  crop_left: ['왼쪽 자르기', 'Crop left', '左侧裁剪', '左クロップ'],
  crop_right: ['오른쪽 자르기', 'Crop right', '右侧裁剪', '右クロップ'],
  crop_top: ['위 자르기', 'Crop top', '顶部裁剪', '上クロップ'],
  crop_bottom: ['아래 자르기', 'Crop bottom', '底部裁剪', '下クロップ'],
  opacity: ['불투명도', 'Opacity', '不透明度', '不透明度'],
  volume: ['볼륨', 'Volume', '音量', '音量'],
  speed: ['속도', 'Speed', '速度', '速度'],
};

export function TimelineKeyframePanel({
  timeline,
  selected,
  playhead,
  onPlayheadChange,
  disabled,
  onRun,
}: {
  timeline: Timeline;
  selected: ClipLocation;
  playhead: number;
  onPlayheadChange: (value: number) => void;
  disabled: boolean;
  onRun: (result: BuildResult<TimelineOperation>) => void;
}) {
  const { t } = useLanguage();
  const { track, clip } = selected;
  const properties = keyframePropertiesForTrack(track);
  const [requestedProperty, setRequestedProperty] = useState<KeyframeProperty>(properties[0] ?? 'scale');
  const propertyName = properties.includes(requestedProperty) ? requestedProperty : properties[0];
  const relativeAt = roundTime(clampTime(playhead - clip.timeline_start, 0, clip.duration));
  const seed = `${clip.id}:${timeline.revision}:${propertyName}:${relativeAt}`;
  const [draft, setDraft] = useState<{
    key: string;
    value: string;
    interpolation: 'linear' | 'hold';
  }>({ key: '', value: '', interpolation: 'linear' });

  if (!propertyName) return null;
  const value = draft.key === seed
    ? draft.value
    : String(roundTime(keyframeValue(clip, propertyName, relativeAt)));
  const interpolation = draft.key === seed ? draft.interpolation : 'linear';
  const limits = KEYFRAME_LIMITS[propertyName];
  const points = [...(clip.keyframes?.[propertyName] ?? [])].sort((first, second) => first.at - second.at);
  const labels = LABELS[propertyName];

  return (
    <section className="desktop-keyframes" aria-label={t('키프레임', 'Keyframes', '关键帧', 'キーフレーム')}>
      <div className="desktop-keyframes-head">
        <b>{t('키프레임', 'Keyframes', '关键帧', 'キーフレーム')}</b>
        <span>{formatTimecode(relativeAt)} / {formatTimecode(clip.duration)}</span>
      </div>
      <div className="desktop-keyframe-form">
        <select
          value={propertyName}
          disabled={disabled}
          aria-label={t('키프레임 속성', 'Keyframe property', '关键帧属性', 'キーフレーム属性')}
          onChange={(event) => setRequestedProperty(event.target.value as KeyframeProperty)}
        >
          {properties.map((property) => {
            const option = LABELS[property];
            return <option key={property} value={property}>{t(...option)}</option>;
          })}
        </select>
        <input
          type="number"
          min={limits.min}
          max={limits.max}
          step={limits.step}
          value={value}
          disabled={disabled}
          aria-label={t(`${t(...labels)} 값`, `${t(...labels)} value`, `${t(...labels)}值`, `${t(...labels)}の値`)}
          onChange={(event) => setDraft({ key: seed, value: event.target.value, interpolation })}
        />
        <select
          value={interpolation}
          disabled={disabled}
          aria-label={t('보간 방식', 'Interpolation', '插值方式', '補間方法')}
          onChange={(event) => setDraft({
            key: seed,
            value,
            interpolation: event.target.value as 'linear' | 'hold',
          })}
        >
          <option value="linear">{t('선형', 'Linear', '线性', 'リニア')}</option>
          <option value="hold">{t('고정', 'Hold', '保持', 'ホールド')}</option>
        </select>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onRun(buildSetKeyframeOperation(
            timeline,
            track,
            clip,
            propertyName,
            relativeAt,
            Number(value),
            interpolation,
          ))}
        >
          {t('현재 위치에 저장', 'Set at playhead', '在播放位置设置', '再生位置に設定')}
        </button>
      </div>
      {points.length ? (
        <div className="desktop-keyframe-list">
          {points.map((point) => (
            <div key={point.id}>
              <button
                type="button"
                className="desktop-keyframe-jump"
                title={point.id}
                disabled={disabled}
                onClick={() => onPlayheadChange(roundTime(clip.timeline_start + point.at))}
              >
                {formatTimecode(point.at)} · {point.value}
              </button>
              <button
                type="button"
                disabled={disabled}
                aria-label={t(`${t(...labels)} 키프레임 삭제`, `Delete ${t(...labels)} keyframe`, `删除${t(...labels)}关键帧`, `${t(...labels)}キーフレームを削除`)}
                onClick={() => onRun(buildRemoveKeyframeOperation(track, clip, propertyName, point.id))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p>{t('현재 속성에는 키프레임이 없습니다.', 'No keyframes for this property.', '当前属性没有关键帧。', 'この属性にはキーフレームがありません。')}</p>
      )}
    </section>
  );
}
