"use client";

type RenderSettings = {
  fps: 24 | 30 | 60;
  quality: "compact" | "balanced" | "high";
  crop_anchor: "left" | "center" | "right";
  speed: number;
  volume: number;
  normalize_audio: boolean;
  mute_audio: boolean;
  fade_in: number;
  fade_out: number;
  look: "natural" | "punchy" | "mono" | "night";
  brightness: number;
  contrast: number;
  gamma: number;
  mirror: boolean;
  captions_enabled: boolean;
  caption_color: string;
  caption_size: number;
  caption_y: number;
  caption_stroke: number;
  caption_bg: boolean;
  caption_bg_color: string;
  platform: string;
  music_track: string;
  music_volume: number;
  music_loop: boolean;
};
type PlatformPreset = { width: number; height: number; label: string };
type Presets = {
  quality_presets: Record<string, Partial<RenderSettings>>;
  caption_layout_presets: Record<string, Partial<RenderSettings>>;
  platform_presets: Record<string, PlatformPreset>;
};

export type { PlatformPreset, Presets, RenderSettings };

export function FinishRack({
  renderSettings,
  patchSettings,
  applyPreset,
  presets,
  t,
}: {
  renderSettings: RenderSettings;
  patchSettings: <K extends keyof RenderSettings>(
    key: K,
    value: RenderSettings[K],
  ) => void;
  applyPreset: (patch: Partial<RenderSettings>) => void;
  presets: Presets | null;
  t: (ko: string, en: string, zh: string, ja: string) => string;
}) {
  return (
    <section className="finish-rack">
      <div className="finish-rack-head">
        <div>
          <p className="kicker">{t("04 · 마무리 설정", "04 · FINISH RACK", "04 · 收尾设置", "04 · 仕上げ設定")}</p>
          <h2>
            {t("보이는 편집값을", "Apply visible edit values to the", "把界面上的编辑数值", "画面上の編集値を")} <span>{t("실제 로컬 렌더", "real local render", "应用到实际的本地渲染", "実際のローカルレンダー")}</span>{t("에도 적용.", ".", "。", "にも適用。")}
          </h2>
        </div>
        <p>
          {t("이 설정은 다음에 만드는 프로젝트의 EDL 안에 저장됩니다. 미리보기용 버튼이 아니라 MoviePy 렌더에서 직접 사용됩니다.", "These settings are saved in the EDL for the next project and used directly by MoviePy rendering, not just for preview.", "这些设置会保存在下一个项目的 EDL 中,并非仅用于预览按钮,而是直接被 MoviePy 渲染使用。", "この設定は次に作るプロジェクトの EDL に保存され、プレビュー用のボタンではなく MoviePy レンダーで直接使用されます。")}
        </p>
      </div>
      <div className="finish-grid">
        <article>
          <span>{t("세로 리프레임", "VERTICAL REFRAME", "竖屏重构图", "縦型リフレーム")}</span>
          <h3>{t("9:16 프레이밍", "9:16 framing", "9:16 取景", "9:16 フレーミング")}</h3>
          <label>
            {t("출력 플랫폼", "Output platform", "输出平台", "出力プラットフォーム")}
            <select
              value={renderSettings.platform}
              onChange={(event) =>
                patchSettings("platform", event.target.value)
              }
            >
              {presets
                ? Object.entries(presets.platform_presets).map(
                    ([key, preset]) => (
                      <option key={key} value={key}>
                        {preset.label} · {preset.width}×{preset.height}
                      </option>
                    ),
                  )
                : (
                    <option value="reels_tiktok_shorts">
                      Reels / TikTok / Shorts (9:16) · 1080×1920
                    </option>
                  )}
            </select>
          </label>
          <label>
            {t("피사체 기준 위치", "Subject anchor", "主体基准位置", "被写体アンカー")}
            <select
              value={renderSettings.crop_anchor}
              onChange={(event) =>
                patchSettings(
                  "crop_anchor",
                  event.target.value as RenderSettings["crop_anchor"],
                )
              }
            >
              <option value="left">{t("왼쪽 우선", "Left", "靠左", "左優先")}</option>
              <option value="center">{t("가운데", "Center", "居中", "中央")}</option>
              <option value="right">{t("오른쪽 우선", "Right", "靠右", "右優先")}</option>
            </select>
          </label>
          <label className="finish-toggle">
            <input
              type="checkbox"
              checked={renderSettings.mirror}
              onChange={(event) =>
                patchSettings("mirror", event.target.checked)
              }
            />{" "}
            {t("좌우 반전", "Mirror horizontally", "水平镜像", "左右反転")}
          </label>
          <p>
            {t("가로 영상을 세로 1080×1920으로 채울 때 어느 쪽을 유지할지 정합니다.", "Choose which side to preserve when filling a vertical 1080×1920 frame from horizontal footage.", "决定把横屏素材填满竖屏 1080×1920 画面时保留哪一侧。", "横型の映像を縦 1080×1920 に収めるとき、どちら側を残すかを決めます。")}
          </p>
        </article>
        <article>
          <span>{t("움직임 + 오디오", "MOTION + AUDIO", "动作 + 音频", "モーション + オーディオ")}</span>
          <h3>{t("속도와 음량", "Speed and volume", "速度与音量", "速度と音量")}</h3>
          <label>
            {t("전체 속도", "Overall speed", "整体速度", "全体速度")} <output>{renderSettings.speed.toFixed(2)}×</output>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.05"
              value={renderSettings.speed}
              onChange={(event) =>
                patchSettings("speed", Number(event.target.value))
              }
            />
          </label>
          <label>
            {t("원본 음량", "Source volume", "原始音量", "ソース音量")} {" "}
            <output>
              {renderSettings.mute_audio
                ? t("음소거", "mute", "静音", "ミュート")
                : `${renderSettings.volume}%`}
            </output>
            <input
              type="range"
              min="0"
              max="200"
              value={renderSettings.volume}
              disabled={renderSettings.mute_audio}
              onChange={(event) =>
                patchSettings("volume", Number(event.target.value))
              }
            />
          </label>
          <div className="finish-pair">
            <label>
              {t("시작 페이드", "Fade in", "淡入", "フェードイン")}
              <input
                type="number"
                min="0"
                max="2"
                step=".02"
                value={renderSettings.fade_in}
                onChange={(event) =>
                  patchSettings("fade_in", Number(event.target.value))
                }
              />
            </label>
            <label>
              {t("끝 페이드", "Fade out", "淡出", "フェードアウト")}
              <input
                type="number"
                min="0"
                max="2"
                step=".02"
                value={renderSettings.fade_out}
                onChange={(event) =>
                  patchSettings("fade_out", Number(event.target.value))
                }
              />
            </label>
          </div>
          <label className="finish-toggle">
            <input
              type="checkbox"
              checked={renderSettings.normalize_audio}
              onChange={(event) =>
                patchSettings("normalize_audio", event.target.checked)
              }
            />{" "}
            {t("음량 정규화", "Normalize volume", "音量归一化", "音量ノーマライズ")}
          </label>
          <label className="finish-toggle">
            <input
              type="checkbox"
              checked={renderSettings.mute_audio}
              onChange={(event) =>
                patchSettings("mute_audio", event.target.checked)
              }
            />{" "}
            {t("원본 오디오 제거", "Mute source audio", "移除原始音频", "ソース音声をミュート")}
          </label>
          <label>
            {t("배경 음악 (작업 공간 내부 경로)", "Background music (path inside workspace)", "背景音乐(工作区内部路径)", "BGM(ワークスペース内のパス)")}
            <input
              value={renderSettings.music_track}
              onChange={(event) =>
                patchSettings("music_track", event.target.value)
              }
              placeholder="inputs/music-bed.mp3"
            />
          </label>
          <label>
            {t("음악 음량", "Music volume", "音乐音量", "音楽音量")} <output>{renderSettings.music_volume}%</output>
            <input
              type="range"
              min="0"
              max="100"
              disabled={!renderSettings.music_track}
              value={renderSettings.music_volume}
              onChange={(event) =>
                patchSettings("music_volume", Number(event.target.value))
              }
            />
          </label>
          <label className="finish-toggle">
            <input
              type="checkbox"
              checked={renderSettings.music_loop}
              disabled={!renderSettings.music_track}
              onChange={(event) =>
                patchSettings("music_loop", event.target.checked)
              }
            />{" "}
            {t("영상 길이에 맞춰 반복 재생", "Loop to match the video length", "循环播放以匹配视频长度", "動画の長さに合わせてループ再生")}
          </label>
        </article>
        <article>
          <span>{t("색상 + 룩", "COLOR + LOOK", "色彩 + 风格", "カラー + ルック")}</span>
          <h3>{t("색감 보정", "Color correction", "色彩校正", "カラー補正")}</h3>
          <label>
            {t("룩 프리셋", "Look preset", "风格预设", "ルックプリセット")}
            <select
              value={renderSettings.look}
              onChange={(event) =>
                patchSettings(
                  "look",
                  event.target.value as RenderSettings["look"],
                )
              }
            >
              <option value="natural">{t("자연스러움", "Natural", "自然", "ナチュラル")}</option>
              <option value="punchy">{t("강한 대비", "Punchy contrast", "强对比", "パンチの効いたコントラスト")}</option>
              <option value="mono">{t("흑백", "Black & white", "黑白", "白黒")}</option>
              <option value="night">{t("야간 보정", "Night lift", "夜景提亮", "夜間補正")}</option>
            </select>
          </label>
          <div className="finish-pair">
            <label>
              {t("밝기", "Brightness", "亮度", "明るさ")} {" "}
              <output>
                {renderSettings.brightness > 0 ? "+" : ""}
                {renderSettings.brightness}
              </output>
              <input
                type="range"
                min="-40"
                max="40"
                value={renderSettings.brightness}
                onChange={(event) =>
                  patchSettings("brightness", Number(event.target.value))
                }
              />
            </label>
            <label>
              {t("대비", "Contrast", "对比度", "コントラスト")} {" "}
              <output>
                {renderSettings.contrast > 0 ? "+" : ""}
                {renderSettings.contrast}
              </output>
              <input
                type="range"
                min="-40"
                max="55"
                value={renderSettings.contrast}
                onChange={(event) =>
                  patchSettings("contrast", Number(event.target.value))
                }
              />
            </label>
          </div>
          <label>
            {t("감마", "Gamma", "伽马", "ガンマ")} <output>{renderSettings.gamma.toFixed(2)}</output>
            <input
              type="range"
              min="0.65"
              max="1.55"
              step=".05"
              value={renderSettings.gamma}
              onChange={(event) =>
                patchSettings("gamma", Number(event.target.value))
              }
            />
          </label>
        </article>
        <article>
          <span>{t("자막 + 전달", "CAPTION + DELIVERY", "字幕 + 交付", "キャプション + 配信")}</span>
          <h3>{t("읽히는 최종본", "A readable final", "易读的成片", "読みやすい最終版")}</h3>
          <label className="finish-toggle">
            <input
              type="checkbox"
              checked={renderSettings.captions_enabled}
              onChange={(event) =>
                patchSettings("captions_enabled", event.target.checked)
              }
            />{" "}
            {t("선택 구간 자막 번인", "Burn captions into kept clips", "为保留片段烧录字幕", "採用クリップに字幕を焼き込む")}
          </label>
          <div className="finish-pair">
            <label>
              {t("자막 색상", "Caption color", "字幕颜色", "キャプションカラー")}
              <input
                type="color"
                value={renderSettings.caption_color}
                onChange={(event) =>
                  patchSettings("caption_color", event.target.value)
                }
              />
            </label>
            <label>
              {t("테두리", "Outline", "描边", "縁取り")} <output>{renderSettings.caption_stroke}px</output>
              <input
                type="range"
                min="0"
                max="8"
                value={renderSettings.caption_stroke}
                onChange={(event) =>
                  patchSettings(
                    "caption_stroke",
                    Number(event.target.value),
                  )
                }
              />
            </label>
          </div>
          <div className="finish-pair">
            <label className="finish-toggle">
              <input
                type="checkbox"
                checked={renderSettings.caption_bg}
                onChange={(event) =>
                  patchSettings("caption_bg", event.target.checked)
                }
              />{" "}
              {t("자막 배경 패널", "Caption background panel", "字幕背景面板", "キャプション背景パネル")}
            </label>
            <label>
              {t("배경 색상", "Background color", "背景颜色", "背景色")}
              <input
                type="color"
                value={renderSettings.caption_bg_color.slice(0, 7)}
                disabled={!renderSettings.caption_bg}
                onChange={(event) =>
                  patchSettings("caption_bg_color", event.target.value)
                }
              />
            </label>
          </div>
          <label>
            {t("자막 크기", "Caption size", "字幕大小", "キャプションサイズ")} <output>{renderSettings.caption_size}px</output>
            <input
              type="range"
              min="38"
              max="110"
              value={renderSettings.caption_size}
              onChange={(event) =>
                patchSettings("caption_size", Number(event.target.value))
              }
            />
          </label>
          <label>
            {t("자막 세로 위치", "Caption vertical position", "字幕垂直位置", "キャプションの縦位置")} <output>{renderSettings.caption_y}%</output>
            <input
              type="range"
              min="48"
              max="84"
              value={renderSettings.caption_y}
              onChange={(event) =>
                patchSettings("caption_y", Number(event.target.value))
              }
            />
          </label>
          <label>
            {t("출력 품질", "Output quality", "输出质量", "出力品質")}
            <select
              value={renderSettings.quality}
              onChange={(event) =>
                patchSettings(
                  "quality",
                  event.target.value as RenderSettings["quality"],
                )
              }
            >
              <option value="compact">{t("간단 · 빠른 검토", "Compact · quick review", "精简 · 快速预览", "コンパクト · 素早い確認")}</option>
              <option value="balanced">{t("균형 · 일반 게시", "Balanced · normal publishing", "均衡 · 常规发布", "バランス · 通常公開")}</option>
              <option value="high">{t("고품질 · 보관/게시", "High · archive/publish", "高质量 · 存档/发布", "高品質 · アーカイブ/公開")}</option>
            </select>
          </label>
          <label>
            {t("프레임레이트", "Frame rate", "帧率", "フレームレート")}
            <select
              value={renderSettings.fps}
              onChange={(event) =>
                patchSettings(
                  "fps",
                  Number(event.target.value) as RenderSettings["fps"],
                )
              }
            >
              <option value="24">{t("24 fps · 시네마틱", "24 fps · cinematic", "24 fps · 电影感", "24 fps · シネマティック")}</option>
              <option value="30">{t("30 fps · 릴 기본", "30 fps · reel standard", "30 fps · Reel 标准", "30 fps · リール標準")}</option>
              <option value="60">{t("60 fps · 빠른 동작", "60 fps · fast action", "60 fps · 快速动作", "60 fps · 高速アクション")}</option>
            </select>
          </label>
          {presets && (
            <label>
              {t("품질 프리셋", "Quality preset", "质量预设", "品質プリセット")}
              <select
                defaultValue=""
                onChange={(event) => {
                  const patch = presets.quality_presets[event.target.value];
                  if (patch) applyPreset(patch);
                  event.target.value = "";
                }}
              >
                <option value="" disabled>
                  {t("프리셋 선택…", "Choose a preset…", "选择预设…", "プリセットを選択…")}
                </option>
                {Object.keys(presets.quality_presets).map((key) => (
                  <option key={key} value={key}>
                    {key.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
          )}
          {presets && (
            <label>
              {t("자막 레이아웃 프리셋", "Caption layout preset", "字幕排版预设", "キャプションレイアウトプリセット")}
              <select
                defaultValue=""
                onChange={(event) => {
                  const patch = presets.caption_layout_presets[event.target.value];
                  if (patch) applyPreset(patch);
                  event.target.value = "";
                }}
              >
                <option value="" disabled>
                  {t("프리셋 선택…", "Choose a preset…", "选择预设…", "プリセットを選択…")}
                </option>
                {Object.keys(presets.caption_layout_presets).map((key) => (
                  <option key={key} value={key}>
                    {key.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
          )}
        </article>
      </div>
      <div className="finish-readout">
        <b>{t("다음 렌더", "Next render", "下一次渲染", "次のレンダー")}</b>
        <span>
          {renderSettings.crop_anchor} crop ·{" "}
          {renderSettings.speed.toFixed(2)}× · {renderSettings.look} ·{" "}
          {renderSettings.mute_audio
            ? t("원본 오디오 끔", "source audio off", "原始音频关闭", "ソース音声オフ")
            : t(`${renderSettings.volume}% 음량`, `${renderSettings.volume}% audio`, `${renderSettings.volume}% 音量`, `${renderSettings.volume}% 音声`)}{" "}
          ·{" "}
          {renderSettings.captions_enabled
            ? t("자막 번인", "burn-in captions", "字幕烧录", "字幕焼き込み")
            : t("자막 없음", "no captions", "无字幕", "字幕なし")}{" "}
          · {renderSettings.fps}fps · {renderSettings.quality}
        </span>
      </div>
    </section>
  );
}
