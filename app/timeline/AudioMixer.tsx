'use client';

import { useLanguage } from '../language';
import type { Timeline, TimelineTrack } from './types';

export function AudioMixer({
  timeline,
  disabled,
  onUpdate,
}: {
  timeline: Timeline;
  disabled: boolean;
  onUpdate: (track: TimelineTrack, changes: Record<string, unknown>) => void;
}) {
  const { t } = useLanguage();
  const tracks = timeline.tracks.filter((track) => ['video', 'audio'].includes(track.type));
  if (!tracks.length) return null;

  return (
    <section className="desktop-inspector-section desktop-mixer">
      <div className="desktop-inspector-head">
        <b>{t('오디오 믹서', 'Audio mixer', '音频混音器', 'オーディオミキサー')}</b>
        <span>{tracks.length}</span>
      </div>
      {tracks.map((track) => (
        <form
          key={`${track.id}:${timeline.revision}`}
          onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            onUpdate(track, {
              volume: Number(values.get('volume')),
              role: String(values.get('role')),
              ducking: values.get('ducking') === 'on',
              duck_level: Number(values.get('duck_level')),
              audio_fx: {
                eq: {
                  low: Number(values.get('eq_low')),
                  mid: Number(values.get('eq_mid')),
                  high: Number(values.get('eq_high')),
                },
                compressor: {
                  enabled: values.get('comp_on') === 'on',
                  threshold: Number(values.get('comp_threshold')),
                  ratio: Number(values.get('comp_ratio')),
                },
              },
            });
          }}
        >
          <div><b title={track.name}>{track.name}</b><span>{track.muted ? 'M' : track.solo ? 'S' : ''}</span></div>
          <label>
            {t('트랙 볼륨', 'Track volume', '轨道音量', 'トラック音量')}
            <input name="volume" type="number" min="0" max="4" step=".05" defaultValue={track.volume ?? 1} disabled={disabled || track.locked} />
          </label>
          <label>
            {t('역할', 'Role', '角色', '役割')}
            <select name="role" defaultValue={track.role ?? 'dialogue'} disabled={disabled || track.locked}>
              <option value="dialogue">{t('대화', 'Dialogue', '对白', '会話')}</option>
              <option value="music">{t('음악', 'Music', '音乐', '音楽')}</option>
              <option value="effects">{t('효과음', 'Effects', '音效', '効果音')}</option>
            </select>
          </label>
          <label className="desktop-mixer-check">
            <input name="ducking" type="checkbox" defaultChecked={Boolean(track.ducking)} disabled={disabled || track.locked} />
            {t('대화 중 자동으로 줄이기', 'Duck under dialogue', '对白时自动降低', '会話中に自動で下げる')}
          </label>
          <label>
            {t('줄인 음량', 'Duck level', '降低后音量', 'ダック音量')}
            <input name="duck_level" type="number" min="0" max="1" step=".05" defaultValue={track.duck_level ?? .35} disabled={disabled || track.locked} />
          </label>
          <label>
            EQ L/M/H
            <div className="desktop-eq">
              <input name="eq_low" type="number" min="-12" max="12" step="1" defaultValue={track.audio_fx?.eq?.low ?? 0} disabled={disabled || track.locked} />
              <input name="eq_mid" type="number" min="-12" max="12" step="1" defaultValue={track.audio_fx?.eq?.mid ?? 0} disabled={disabled || track.locked} />
              <input name="eq_high" type="number" min="-12" max="12" step="1" defaultValue={track.audio_fx?.eq?.high ?? 0} disabled={disabled || track.locked} />
            </div>
          </label>
          <label className="desktop-mixer-check">
            <input name="comp_on" type="checkbox" defaultChecked={Boolean(track.audio_fx?.compressor?.enabled)} disabled={disabled || track.locked} />
            {t('컴프레서', 'Compressor', '压缩器', 'コンプレッサー')}
          </label>
          <label>
            {t('임계값 / 비율', 'Threshold / ratio', '阈值 / 比率', 'しきい値 / 比率')}
            <div className="desktop-eq">
              <input name="comp_threshold" type="number" min="-60" max="0" step="1" defaultValue={track.audio_fx?.compressor?.threshold ?? -18} disabled={disabled || track.locked} />
              <input name="comp_ratio" type="number" min="1" max="20" step="0.5" defaultValue={track.audio_fx?.compressor?.ratio ?? 3} disabled={disabled || track.locked} />
            </div>
          </label>
          <button type="submit" disabled={disabled || track.locked}>
            {t('믹서 적용', 'Apply mix', '应用混音', 'ミックスを適用')}
          </button>
        </form>
      ))}
    </section>
  );
}
