"use client";

import { useState } from "react";
import { UiText, GateStrip, sceneScale, useForge } from "./forge-shared";

function drawWrapped(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  line: number,
) {
  let current = "";
  let row = 0;
  text.split(/\s+/).forEach((word) => {
    const test = `${current}${word} `;
    if (ctx.measureText(test).width > width) {
      ctx.fillText(current, x, y + row * line);
      current = `${word} `;
      row += 1;
    } else current = test;
  });
  if (current) ctx.fillText(current, x, y + row * line);
  return y + (row + 1) * line;
}

export function ExportRoom({ forge }: { forge: ReturnType<typeof useForge> }) {
  const { project, allGreen, gates, recordExport } = forge;
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const validReel = url.includes("/reel/");
  const postUrl = url.includes("/p/");
  const permalinkText = validReel
    ? "Reels menu. Good."
    : postUrl
      ? "You opened the post menu. This is not a reel."
      : url
        ? "Paste an Instagram /reel/ permalink."
        : "Check the reel after publishing.";
  const recipe = `ffmpeg -loop 1 -i scene-a.png -loop 1 -i scene-b.png -filter_complex "[0:v]scale=1080:1920,zoompan=z='min(zoom+0.0015,1.22)':d=150[a];[1:v]scale=1080:1920,zoompan=z='if(lte(on,0),1.22,max(1.06,zoom-0.001))':d=150[b];[a][b]concat=n=2:v=1:a=0" -r 30 local-video.mp4`;
  const startExport = () => {
    if (!allGreen || exporting) return;
    if (!("MediaRecorder" in window)) {
      setStatus(
        "WebM is not available in this browser. Copy the ffmpeg zoom + cut recipe instead.",
      );
      return;
    }
    try {
      setExporting(true);
      setStatus(
        "Rendering a WebM in this browser. Keep this tab open for 10 seconds.",
      );
      const canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 1920;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas is unavailable");
      const stream = canvas.captureStream(30);
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mime });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "local-video-workspace.webm";
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        recordExport();
        setExporting(false);
        setStatus("WebM exported. This app did not create an MP4.");
      };
      const total = (project.durationA + project.durationB) * 1000;
      const start = performance.now();
      const draw = (now: number) => {
        const elapsed = Math.min(now - start, total);
        const isA = elapsed < project.durationA * 1000;
        const scene = isA ? project.sceneA : project.sceneB;
        const segment = isA
          ? elapsed / (project.durationA * 1000)
          : (elapsed - project.durationA * 1000) / (project.durationB * 1000);
        const scale = sceneScale(scene, segment);
        ctx.fillStyle =
          scene.mood === "chaos"
            ? "#17110c"
            : scene.mood === "calm"
              ? "#0d1712"
              : "#101018";
        ctx.fillRect(0, 0, 1080, 1920);
        ctx.save();
        ctx.translate(540, 960);
        ctx.scale(scale, scale);
        ctx.translate(-540, -960);
        ctx.fillStyle = "#f5c400";
        ctx.font = "700 42px Arial";
        ctx.fillText("LOCAL", 80, 115);
        ctx.fillStyle = "#ffffff";
        ctx.font = "800 96px Arial";
        let next = drawWrapped(ctx, scene.headline, 80, 610, 880, 114);
        ctx.fillStyle = "#b8b8b8";
        ctx.font = "500 42px Arial";
        next = drawWrapped(
          ctx,
          scene.body.replace(/\n/g, " "),
          80,
          next + 70,
          870,
          60,
        );
        ctx.fillStyle = "#f5c400";
        ctx.font = "700 46px Arial";
        drawWrapped(ctx, scene.accent, 80, Math.max(next + 100, 1450), 870, 58);
        ctx.restore();
        if (elapsed < total) requestAnimationFrame(draw);
        else recorder.stop();
      };
      recorder.start();
      requestAnimationFrame(draw);
    } catch {
      setExporting(false);
      setStatus(
        "WebM export could not start. Copy the ffmpeg zoom + cut recipe instead.",
      );
    }
  };
  return (
    <main className="forge-main subpage export-room">
      <section className="page-intro">
        <p className="kicker">
          <UiText ko="최종 확인" en="FINAL CHECK" zh="最终确认" ja="最終チェック" />
        </p>
        <h1>
          <UiText ko="내보내기" en="Export room" zh="导出" ja="エクスポートルーム" />
        </h1>
        <p>
          <UiText
            ko="감정의 컷을 미리 보고, 모든 게이트가 통과일 때만 내보내세요."
            en="Preview the emotional cut. Export only when every gate is green."
            zh="先预览情绪剪辑,只有所有关卡都通过才导出。"
            ja="感情のカットをプレビューし、すべてのゲートが緑になったときだけ書き出しましょう。"
          />
        </p>
      </section>
      <GateStrip gates={gates} />
      <section className="export-grid">
        <div className="export-preview">
          <span>
            <UiText ko="10초 모션 미리보기" en="10s MOTION PREVIEW" zh="10 秒动效预览" ja="10 秒モーションプレビュー" />
          </span>
          <div className="export-monitor">
            <div className="monitor-a">
              <b>{project.sceneA.headline}</b>
              <small>
                <UiText ko="확대" en="zoom in" zh="放大" ja="ズームイン" />
              </small>
            </div>
            <div className="monitor-cut">HARD CUT</div>
            <div className="monitor-b">
              <b>{project.sceneB.headline}</b>
              <small>
                {project.sceneB.motion} <UiText ko="카메라" en="camera" zh="镜头" ja="カメラ" />
              </small>
            </div>
          </div>
          <p>
            <UiText ko="오디오" en="Audio" zh="音频" ja="オーディオ" />: <b>{project.audio}</b> · 30 fps ·
            1080 × 1920
          </p>
        </div>
        <div className="export-actions">
          <button
            className="export-button"
            disabled={!allGreen || exporting}
            onClick={startExport}
          >
            {exporting ? (
              <UiText ko="WebM 렌더링 중…" en="Rendering WebM…" zh="正在渲染 WebM…" ja="WebM をレンダー中…" />
            ) : allGreen ? (
              <UiText ko="WebM 내보내기" en="Export WebM" zh="导出 WebM" ja="WebM を書き出す" />
            ) : (
              <UiText
                ko="내보내기 (모든 게이트 통과 필요)"
                en="Export (gates green only)"
                zh="导出(需所有关卡通过)"
                ja="書き出す(全ゲート通過が必要)"
              />
            )}
          </button>
          <p>
            {status ||
              (allGreen ? (
                <UiText
                  ko="브라우저가 지원하는 경우 WebM을 만들 수 있습니다. 생성되지 않은 MP4를 만들었다고 표시하지 않습니다."
                  en="WebM is offered where your browser supports it. MP4 is never claimed unless created."
                  zh="如果浏览器支持,会提供 WebM。系统不会在未生成 MP4 时谎称已生成。"
                  ja="ブラウザが対応していれば WebM を用意します。生成していない MP4 を生成済みと表示することはありません。"
                />
              ) : (
                <UiText
                  ko="내보내기 전에 빨간 게이트를 해결하세요."
                  en="Fix the red gates before export."
                  zh="导出前请先解决红色关卡。"
                  ja="書き出す前に赤いゲートを解決してください。"
                />
              ))}
          </p>
          <button
            className="recipe-button"
            onClick={async () => {
              await navigator.clipboard?.writeText(recipe);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1800);
            }}
          >
            {copied ? (
              <UiText ko="레시피 복사됨" en="Recipe copied" zh="配方已复制" ja="レシピをコピーしました" />
            ) : (
              <UiText
                ko="ffmpeg 확대 + 컷 레시피 복사"
                en="Copy ffmpeg zoom + cut recipe"
                zh="复制 ffmpeg 放大 + 剪切配方"
                ja="ffmpeg のズーム + カットレシピをコピー"
              />
            )}
          </button>
          <label className="permalink-label">
            <UiText ko="Instagram 릴 고유 링크" en="Instagram reel permalink" zh="Instagram Reel 永久链接" ja="Instagram リールのパーマリンク" />
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://www.instagram.com/reel/..."
            />
          </label>
          <div className={`permalink-result ${validReel ? "pass" : "fail"}`}>
            <b>
              {validReel ? (
                "READY FOR /REEL/"
              ) : (
                <UiText ko="고유 링크 확인" en="PERMALINK CHECK" zh="永久链接检查" ja="パーマリンクチェック" />
              )}
            </b>
            <span>{permalinkText}</span>
          </div>
        </div>
      </section>
    </main>
  );
}
