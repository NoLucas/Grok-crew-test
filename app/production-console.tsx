"use client";

import { useCallback, useEffect, useState } from "react";
import { useLanguage, type AppLanguage } from "./language";
import {
  FinishRack,
  type Presets,
  type RenderSettings,
} from "./production-finish-rack";
import { SiteHeader } from "./site-header";

type TimelineClip = {
  in: number;
  out: number;
  keep: boolean;
  caption: string;
  speaker?: string;
};
type StudioProject = {
  id: string;
  title: string;
  source_path: string;
  output_path: string;
  caption: string;
  timeline_json: { clips: TimelineClip[] };
  created_at: string;
};
type StudioJob = {
  id: string;
  project_id: string;
  kind: "render" | "instagram_publish";
  status: string;
  approved: number;
  progress?: number;
  cancel_requested?: number;
  error_text?: string | null;
  created_at: string;
  result_json?: Record<string, unknown> | null;
};
type StudioHealth = {
  status: string;
  bind: string;
  workspace: string;
  database: string;
  moviepy_installed: boolean;
  instagram_publish_enabled: boolean;
  credentials_configured: boolean;
};
type BotEditMethod = {
  method: {
    hook_strategy: "payoff_first" | "question_first" | "chronological";
    pacing: "tight" | "balanced" | "deliberate";
    filler_policy: "remove" | "review" | "keep";
    caption_mode: "burn_in" | "off";
    reframe_anchor: "left" | "center" | "right";
    look: RenderSettings["look"];
    audio_policy: "preserve" | "normalize" | "mute";
    speed: number;
    fps: RenderSettings["fps"];
    quality: RenderSettings["quality"];
  };
  updated_by: string;
  updated_at: string | null;
  is_default: boolean;
};

const studio = "http://127.0.0.1:7214";
const fallbackTimeline: TimelineClip[] = [
  { in: 1.8, out: 3.65, keep: true, caption: "SIX LINES", speaker: "S0" },
  { in: 4.1, out: 6.2, keep: true, caption: "ONE RULE", speaker: "S0" },
  { in: 6.45, out: 9.8, keep: true, caption: "NO GREETING", speaker: "S0" },
];
const defaultRenderSettings: RenderSettings = {
  fps: 30,
  quality: "balanced",
  crop_anchor: "center",
  speed: 1,
  volume: 100,
  normalize_audio: false,
  mute_audio: false,
  fade_in: 0.08,
  fade_out: 0.08,
  look: "natural",
  brightness: 0,
  contrast: 0,
  gamma: 1,
  mirror: false,
  captions_enabled: true,
  caption_color: "#FFFFFF",
  caption_size: 78,
  caption_y: 74,
  caption_stroke: 3,
  caption_bg: false,
  caption_bg_color: "#000000",
  platform: "reels_tiktok_shorts",
  music_track: "",
  music_volume: 30,
  music_loop: true,
};

// Snapshots the browser's local Cut Log draft (localStorage) into the EDL once, at project
// creation time. This intentionally does NOT read a project's persisted Operations cut-map
// artifact (SQLite) — Cut Log and Operations are two independent, unsynchronized sources of
// truth. A bot-saved cut map is invisible here unless it also lives in this browser's Cut Log.
function cutLogTimeline(): TimelineClip[] {
  try {
    const saved = JSON.parse(
      window.localStorage.getItem("localVideoCutLog") ?? "{}",
    ) as {
      clips?: {
        start: number;
        end: number;
        keep: boolean;
        text: string;
        speaker?: string;
      }[];
    };
    const clips = (saved.clips ?? [])
      .filter((clip) => clip.keep && clip.end > clip.start)
      .map((clip) => ({
        in: clip.start,
        out: clip.end,
        keep: true,
        caption: (clip.text.match(/[\p{L}\p{N}']+/gu) ?? ["VIDEO"])
          .slice(0, 2)
          .join(" ")
          .toUpperCase(),
        speaker: clip.speaker,
      }));
    return clips.length ? clips : fallbackTimeline;
  } catch {
    return fallbackTimeline;
  }
}

function stamp(value: string, language: AppLanguage) {
  const locale = language === "ko" ? "ko-KR" : language === "zh" ? "zh-CN" : language === "ja" ? "ja-JP" : "en-US";
  return value
    ? new Date(value).toLocaleString(locale, {
        hour: "2-digit",
        minute: "2-digit",
        month: "short",
        day: "numeric",
      })
    : "—";
}

export default function ProductionConsole() {
  const { t, language } = useLanguage();
  const [health, setHealth] = useState<StudioHealth | null>(null);
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [jobs, setJobs] = useState<StudioJob[]>([]);
  const [botEditMethod, setBotEditMethod] = useState<BotEditMethod | null>(
    null,
  );
  const [presets, setPresets] = useState<Presets | null>(null);
  const [title, setTitle] = useState("Untitled video project");
  const [sourcePath, setSourcePath] = useState("inputs/source.mp4");
  const [outputPath, setOutputPath] = useState("outputs/final-video.mp4");
  const [caption, setCaption] = useState(
    "One ask. Six lines. No greeting essay.\n\n#aiatwork #prompts",
  );
  const [selected, setSelected] = useState("");
  const [token, setToken] = useState("");
  const [approved, setApproved] = useState(false);
  const [shareToFeed, setShareToFeed] = useState(true);
  const [autoUpload, setAutoUpload] = useState(false);
  const [renderSettings, setRenderSettings] = useState<RenderSettings>(
    defaultRenderSettings,
  );
  const [finishLoaded, setFinishLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const patchSettings = <K extends keyof RenderSettings>(
    key: K,
    value: RenderSettings[K],
  ) => setRenderSettings((current) => ({ ...current, [key]: value }));
  const applyPreset = (patch: Partial<RenderSettings>) =>
    setRenderSettings((current) => ({ ...current, ...patch }));

  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (init?.body) headers.set("Content-Type", "application/json");
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const response = await fetch(`${studio}${path}`, { ...init, headers });
      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok)
        throw new Error(
          String(data.error ?? `Local Studio error ${response.status}`),
        );
      return data;
    },
    [token],
  );
  const refresh = useCallback(
    async (quiet = false) => {
      try {
        const [nextHealth, nextProjects, nextJobs, nextMethod, nextPresets] =
          await Promise.all([
            api("/health"),
            api("/api/projects"),
            api("/api/jobs"),
            api("/api/edit-method"),
            api("/api/presets"),
          ]);
        setHealth(nextHealth as unknown as StudioHealth);
        setProjects((nextProjects.projects ?? []) as StudioProject[]);
        setJobs((nextJobs.jobs ?? []) as StudioJob[]);
        setBotEditMethod(nextMethod as unknown as BotEditMethod);
        setPresets(nextPresets as unknown as Presets);
        if (!quiet)
          setMessage(
            t("로컬 제작 서비스가 연결되었습니다. 모든 작업 데이터는 이 PC의 SQLite에 저장됩니다.", "Local Studio is connected. All work data is stored in SQLite on this computer.", "本地制作服务已连接。所有作业数据都保存在这台电脑的 SQLite 中。", "ローカル制作サービスに接続されました。すべての作業データはこの PC の SQLite に保存されます。"),
          );
      } catch (error) {
        setHealth(null);
        if (!quiet)
          setMessage(
            error instanceof Error
              ? `${error.message} — ${t("local_studio를 먼저 실행하세요.", "Start local_studio first.", "请先启动 local_studio。", "先に local_studio を起動してください。")}`
              : t("Local Studio에 연결할 수 없습니다.", "Cannot connect to Local Studio.", "无法连接到 Local Studio。", "Local Studio に接続できません。"),
          );
      }
    },
    [api, t],
  );
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [refresh]);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem("localVideoFinishRack");
        if (saved)
          setRenderSettings({
            ...defaultRenderSettings,
            ...(JSON.parse(saved) as Partial<RenderSettings>),
          });
      } catch {
        /* Use the local default if a previous draft cannot be read. */
      } finally {
        setFinishLoaded(true);
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);
  useEffect(() => {
    if (finishLoaded)
      window.localStorage.setItem(
        "localVideoFinishRack",
        JSON.stringify(renderSettings),
      );
  }, [renderSettings, finishLoaded]);

  const applyBotEditMethod = () => {
    if (!botEditMethod) {
      setMessage(t("먼저 Local Studio의 봇 편집 방법을 불러오세요.", "Load the bot edit method from Local Studio first.", "请先从 Local Studio 加载机器人剪辑方式。", "先に Local Studio からボットの編集方式を読み込んでください。"));
      return;
    }
    const method = botEditMethod.method;
    setRenderSettings((current) => ({
      ...current,
      crop_anchor: method.reframe_anchor,
      speed: method.speed,
      look: method.look,
      fps: method.fps,
      quality: method.quality,
      captions_enabled: method.caption_mode === "burn_in",
      normalize_audio: method.audio_policy === "normalize",
      mute_audio: method.audio_policy === "mute",
    }));
    setMessage(
      t(`${botEditMethod.updated_by}의 편집 방법을 Finish Rack에 적용했습니다. 렌더는 봇 정책을 따르고 Instagram 업로드는 프로젝트의 자동 업로드 설정을 따릅니다.`, `Applied ${botEditMethod.updated_by}'s edit method to the Finish Rack. Rendering follows the bot policy and Instagram upload follows the project's auto-upload setting.`, `已将 ${botEditMethod.updated_by} 的剪辑方式应用到 Finish Rack。渲染遵循机器人策略,Instagram 上传遵循项目的自动上传设置。`, `${botEditMethod.updated_by} の編集方式を Finish Rack に適用しました。レンダーはボットポリシーに従い、Instagram アップロードはプロジェクトの自動アップロード設定に従います。`),
    );
  };

  const createProject = async () => {
    setBusy(true);
    try {
      const response = await api("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          title,
          source_path: sourcePath,
          output_path: outputPath,
          caption,
          timeline: {
            schema: "local-video-workspace.edl/v1",
            clips: cutLogTimeline(),
            render_settings: renderSettings,
            bot_edit_method: botEditMethod?.method ?? null,
            bot_edit_method_by: botEditMethod?.updated_by ?? null,
            bot_edit_method_at: botEditMethod?.updated_at ?? null,
          },
        }),
      });
      const project = response.project as StudioProject;
      setSelected(project.id);
      setApproved(false);
      setMessage(
        t("프로젝트와 Cut Log EDL을 로컬 SQLite에 저장했습니다. 이제 렌더 승인을 기록할 수 있습니다.", "The project and Cut Log EDL were saved to local SQLite. You can now record render approval.", "项目和 Cut Log EDL 已保存到本地 SQLite。现在可以记录渲染批准了。", "プロジェクトと Cut Log EDL をローカル SQLite に保存しました。これでレンダー承認を記録できます。"),
      );
      await refresh(true);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : t("프로젝트를 만들지 못했습니다.", "Could not create the project.", "无法创建项目。", "プロジェクトを作成できませんでした。"),
      );
    } finally {
      setBusy(false);
    }
  };
  const queueRender = async () => {
    if (!selected) {
      setMessage(t("먼저 로컬 프로젝트를 만드세요.", "Create a local project first.", "请先创建本地项目。", "先にローカルプロジェクトを作成してください。"));
      return;
    }
    if (!approved) {
      setMessage(t("렌더 전에 사람 승인을 체크하세요.", "Record human approval before rendering.", "渲染前请勾选人工批准。", "レンダー前に人による承認をチェックしてください。"));
      return;
    }
    setBusy(true);
    try {
      await api(`/api/projects/${selected}/render`, {
        method: "POST",
        body: JSON.stringify({ approved: true, requested_by: "Local browser" }),
      });
      setMessage(
        t("렌더 작업을 대기열에 넣었습니다. 아래에서 “승인된 작업 실행”을 누르면 이 PC에서 MoviePy가 렌더합니다.", "The render job is queued. Choose Run approved job below to render with MoviePy on this computer.", "渲染任务已加入队列。在下面点击“执行已批准的任务”,MoviePy 就会在这台电脑上渲染。", "レンダージョブをキューに入れました。下の「承認済みジョブを実行」を押すと、この PC で MoviePy がレンダーします。"),
      );
      await refresh(true);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : t("렌더 작업을 만들지 못했습니다.", "Could not create the render job.", "无法创建渲染任务。", "レンダージョブを作成できませんでした。"),
      );
    } finally {
      setBusy(false);
    }
  };
  const queueInstagram = async () => {
    if (!selected) {
      setMessage(t("프로젝트를 먼저 선택하세요.", "Choose a project first.", "请先选择项目。", "先にプロジェクトを選択してください。"));
      return;
    }
    setBusy(true);
    try {
      const response = await api(`/api/projects/${selected}/instagram`, {
        method: "POST",
        body: JSON.stringify({
          render_path: outputPath,
          caption,
          share_to_feed: shareToFeed,
          auto_upload: autoUpload,
          requested_by: "Local browser",
        }),
      });
      const job = response.job as StudioJob;
      if (autoUpload) {
        setMessage(t("Instagram 자동 업로드를 시작했습니다…", "Instagram auto-upload started…", "已开始 Instagram 自动上传…", "Instagram 自動アップロードを開始しました…"));
        const final = (await pollJob(job.id)) ?? job;
        setMessage(
          final.status === "succeeded"
            ? t("Instagram 업로드가 완료되었습니다.", "Instagram upload completed.", "Instagram 上传已完成。", "Instagram アップロードが完了しました。")
            : t(`업로드 결과: ${final.status}${final.error_text ? ` — ${final.error_text}` : ""}`, `Upload result: ${final.status}${final.error_text ? ` — ${final.error_text}` : ""}`, `上传结果:${final.status}${final.error_text ? ` — ${final.error_text}` : ""}`, `アップロード結果:${final.status}${final.error_text ? ` — ${final.error_text}` : ""}`),
        );
      } else {
        setMessage(t("Instagram 업로드 작업을 대기열에 넣었습니다. 작업 보드에서 바로 실행할 수 있습니다.", "Instagram upload is queued. You can run it directly from the job board.", "Instagram 上传任务已加入队列。可以直接在任务看板中执行。", "Instagram アップロードをキューに入れました。ジョブボードから直接実行できます。"));
      }
      await refresh(true);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : t("게시 작업을 만들지 못했습니다.", "Could not create the publish job.", "无法创建发布任务。", "公開ジョブを作成できませんでした。"),
      );
    } finally {
      setBusy(false);
    }
  };
  const pollJob = async (jobId: string): Promise<StudioJob | null> => {
    for (;;) {
      let current: StudioJob | null = null;
      try {
        const response = await api(`/api/jobs/${jobId}`);
        current = (response.job ?? null) as StudioJob | null;
      } catch {
        return null;
      }
      if (!current) return null;
      setJobs((list) => list.map((item) => (item.id === current!.id ? current! : item)));
      if (!["queued", "running"].includes(current.status)) return current;
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }
  };
  const runJob = async (job: StudioJob) => {
    setBusy(true);
    try {
      const response = await api(`/api/jobs/${job.id}/run`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const queued = response.job as StudioJob;
      setJobs((list) => list.map((item) => (item.id === queued.id ? queued : item)));
      setMessage(t("작업이 백그라운드에서 실행 중입니다…", "The job is running in the background…", "任务正在后台运行…", "ジョブはバックグラウンドで実行中です…"));
      const final = (await pollJob(job.id)) ?? queued;
      setMessage(
        final.status === "succeeded"
          ? t(`${job.kind === "render" ? "로컬 MP4 렌더" : "Instagram 게시"}가 완료되었습니다.`, `${job.kind === "render" ? "Local MP4 render" : "Instagram publishing"} completed.`, `${job.kind === "render" ? "本地 MP4 渲染" : "Instagram 发布"}已完成。`, `${job.kind === "render" ? "ローカル MP4 レンダー" : "Instagram 公開"}が完了しました。`)
          : t(`작업 결과: ${final.status}${final.error_text ? ` — ${final.error_text}` : ""}`, `Job result: ${final.status}${final.error_text ? ` — ${final.error_text}` : ""}`, `任务结果:${final.status}${final.error_text ? ` — ${final.error_text}` : ""}`, `ジョブ結果:${final.status}${final.error_text ? ` — ${final.error_text}` : ""}`),
      );
      await refresh(true);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : t("작업을 실행하지 못했습니다.", "Could not run the job.", "无法执行任务。", "ジョブを実行できませんでした。"),
      );
    } finally {
      setBusy(false);
    }
  };
  const cancelJob = async (job: StudioJob) => {
    try {
      await api(`/api/jobs/${job.id}/cancel`, { method: "POST", body: JSON.stringify({}) });
      setMessage(t("취소를 요청했습니다. 현재 처리 중인 단계가 끝나면 반영됩니다.", "Cancellation requested. It takes effect after the current step finishes.", "已请求取消。当前处理中的步骤结束后会生效。", "キャンセルをリクエストしました。現在処理中のステップが終わると反映されます。"));
      await refresh(true);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : t("취소 요청을 보내지 못했습니다.", "Could not send the cancellation request.", "无法发送取消请求。", "キャンセルリクエストを送信できませんでした。"),
      );
    }
  };
  const selectedProject = projects.find((project) => project.id === selected);
  const selectedJobs = jobs.filter((job) => job.project_id === selected);
  const contract = JSON.stringify(
    {
      scope: "127.0.0.1 only",
      actor: "Grok bot",
      on_entry:
        "all local editing features enabled; local render defaults to auto_local",
      bot_choice: ["auto_local render", "approval_required render"],
      instagram_upload: "queue manually or auto-upload per project",
      never: ["read Meta credentials", "access outside workspace"],
    },
    null,
    2,
  );

  return (
    <>
      <SiteHeader current="production" />
      <main className="production-main">
        <section className="production-hero">
          <div>
            <p className="kicker">{t("로컬 제작 노드", "LOCAL PRODUCTION NODE", "本地制作节点", "ローカル制作ノード")}</p>
            <h1>
              {t("컷 로그부터", "From cut log to", "从剪辑记录开始,", "カットログから")}
              <br />
              <span>
                {t(
                  "실제 MP4와 게시 대기열까지.",
                  "a real MP4 and publish queue.",
                  "到真正的 MP4 和发布队列。",
                  "実際の MP4 と公開キューまで。",
                )}
              </span>
            </h1>
            <p>
              {t(
                "Grok bot은 편집 계획과 대기열을 만들 수 있습니다. 파일·SQLite·자격증명은 모두 이 PC에 남고, Instagram 업로드는 프로젝트의 자동 업로드 설정을 따릅니다.",
                "Grok bots can plan edits and prepare queues. Files, SQLite, and credentials stay on this PC; Instagram upload follows the project's auto-upload setting.",
                "Grok bot 可以规划剪辑并准备队列。文件、SQLite 和凭证都留在这台电脑上,Instagram 上传遵循项目的自动上传设置。",
                "Grok bot は編集を計画し、キューを準備できます。ファイル・SQLite・認証情報はすべてこの PC に残り、Instagram アップロードはプロジェクトの自動アップロード設定に従います。",
              )}
            </p>
          </div>
          <aside className={`production-health ${health ? "ready" : ""}`}>
            <span>{t("로컬 스튜디오", "LOCAL STUDIO", "本地工作室", "ローカルスタジオ")}</span>
            <b>{health ? t("연결됨", "CONNECTED", "已连接", "接続済み") : t("오프라인", "OFFLINE", "离线", "オフライン")}</b>
            <p>
              {health
                ? `SQLite · ${health.moviepy_installed ? t("MoviePy 준비됨", "MoviePy ready", "MoviePy 已就绪", "MoviePy 準備完了") : t("MoviePy 설치 필요", "MoviePy install needed", "需要安装 MoviePy", "MoviePy のインストールが必要")} · ${t("Instagram 자격증명", "Instagram credentials", "Instagram 凭证", "Instagram 認証情報")} ${health.instagram_publish_enabled ? t("준비됨", "ready", "已就绪", "準備完了") : t("필요", "needed", "需要设置", "必要")}`
                : t(
                    "local_studio/studio_server.py를 실행하면 연결됩니다.",
                    "Start local_studio/studio_server.py to connect.",
                    "运行 local_studio/studio_server.py 即可连接。",
                    "local_studio/studio_server.py を起動すると接続されます。",
                  )}
            </p>
            <button onClick={() => void refresh()} disabled={busy}>
              {t("연결 다시 확인", "Check connection", "重新检查连接", "接続を再確認")}
            </button>
          </aside>
        </section>
        <div className="production-note">
          <b>{t("로컬 우선", "LOCAL FIRST", "本地优先", "ローカルファースト")}</b>
          <span>
            {t("소스는", "Sources are in", "源文件在", "ソースは")} <code>local_studio/workspace/inputs</code>, {t("결과물은", "and output is in", "结果在", "出力は")} <code>workspace/outputs</code>{t("입니다. 프로젝트·작업 이력은 SQLite에 저장됩니다. 입장한 봇은 모든 로컬 기능을 사용할 수 있고, 로컬 렌더는 기본 자동 실행 또는 사람 승인 모드를 봇별로 선택합니다.", ". Project and job history is stored in SQLite. Entered bots can use every local function and choose automatic or human-approved local rendering.", "。项目和任务历史保存在 SQLite 中。入场的机器人可以使用所有本地功能,并按机器人自行选择默认自动执行或人工批准的本地渲染模式。", "です。プロジェクトと作業履歴は SQLite に保存されます。入場したボットはすべてのローカル機能を使用でき、ローカルレンダーはボットごとにデフォルトの自動実行か人による承認モードかを選べます。")}
          </span>
        </div>
        <section className="bot-method-panel">
          <div>
            <p className="kicker">{t("봇 편집 방식", "BOT EDIT METHOD", "机器人剪辑方式", "ボット編集方式")}</p>
            <h2>
              {t("Grok bot이 정한", "The edit method chosen by the", "Grok bot 决定的", "Grok bot が決めた")} <span>{t("편집 방식", "Grok bot", "剪辑方式", "編集方式")}</span>
            </h2>
            <p>
              {t("봇은 훅 순서, 템포, 군더더기 처리, 자막, 리프레임, 룩, 오디오, 속도, FPS, 품질을 로컬 API에 설정할 수 있습니다. 아래 버튼을 누르면 실제 Finish Rack과 새 프로젝트 EDL에 반영됩니다.", "Bots can set hook order, pacing, filler handling, captions, reframing, look, audio, speed, FPS, and quality through the local API. The button below applies the choice to the real Finish Rack and new project EDLs.", "机器人可以通过本地 API 设置钩子顺序、节奏、冗余处理、字幕、重构图、风格、音频、速度、FPS 和质量。点击下面的按钮会应用到实际的 Finish Rack 和新项目 EDL 中。", "ボットはフックの順序、テンポ、フィラー処理、キャプション、リフレーム、ルック、オーディオ、速度、FPS、品質をローカル API で設定できます。下のボタンを押すと、実際の Finish Rack と新しいプロジェクト EDL に反映されます。")}
            </p>
          </div>
          <aside>
            {botEditMethod ? (
              <>
                <span>
                  {botEditMethod.is_default
                    ? t("기본 편집 방식", "DEFAULT METHOD", "默认剪辑方式", "デフォルト方式")
                    : t(`${botEditMethod.updated_by}가 설정`, `SET BY ${botEditMethod.updated_by}`, `由 ${botEditMethod.updated_by} 设置`, `${botEditMethod.updated_by} が設定`)}
                </span>
                <b>
                  {botEditMethod.method.hook_strategy.replaceAll("_", " ")} ·{" "}
                  {t(`${botEditMethod.method.pacing} 템포`, `${botEditMethod.method.pacing} pace`, `${botEditMethod.method.pacing} 节奏`, `${botEditMethod.method.pacing} テンポ`)}
                </b>
                <div className="bot-method-tags">
                  <em>{t(`${botEditMethod.method.filler_policy} 군더더기`, `${botEditMethod.method.filler_policy} filler`, `${botEditMethod.method.filler_policy} 冗余`, `${botEditMethod.method.filler_policy} フィラー`)}</em>
                  <em>{botEditMethod.method.caption_mode}</em>
                  <em>{t(`${botEditMethod.method.reframe_anchor} 프레임`, `${botEditMethod.method.reframe_anchor} frame`, `${botEditMethod.method.reframe_anchor} 取景`, `${botEditMethod.method.reframe_anchor} フレーム`)}</em>
                  <em>{botEditMethod.method.look}</em>
                  <em>{t(`${botEditMethod.method.audio_policy} 오디오`, `${botEditMethod.method.audio_policy} audio`, `${botEditMethod.method.audio_policy} 音频`, `${botEditMethod.method.audio_policy} オーディオ`)}</em>
                  <em>
                    {botEditMethod.method.speed.toFixed(2)}× ·{" "}
                    {botEditMethod.method.fps}fps ·{" "}
                    {botEditMethod.method.quality}
                  </em>
                </div>
                <small>
                  {botEditMethod.updated_at
                    ? `${botEditMethod.updated_by} · ${stamp(botEditMethod.updated_at, language)}`
                    : t("아직 봇이 별도 편집 방법을 설정하지 않았습니다.", "No bot-specific edit method has been set yet.", "还没有机器人设置专属的剪辑方式。", "まだボット固有の編集方式は設定されていません。")}
                </small>
                <button onClick={applyBotEditMethod} disabled={busy}>
                  {t("봇 편집 방식 적용", "Apply bot edit method", "应用机器人剪辑方式", "ボット編集方式を適用")}
                </button>
              </>
            ) : (
              <>
                <span>{t("로컬 스튜디오 오프라인", "LOCAL STUDIO OFFLINE", "本地工作室离线", "ローカルスタジオオフライン")}</span>
                <b>{t("편집 방식을 불러오는 중입니다.", "Loading the edit method.", "正在加载剪辑方式。", "編集方式を読み込み中です。")}</b>
                <p>
                  {t("Local Studio를 실행하면 봇이 설정한 방식을 이곳에서 확인할 수 있습니다.", "Start Local Studio to review the method set by a bot here.", "启动 Local Studio 后即可在这里查看机器人设置的方式。", "Local Studio を起動すると、ボットが設定した方式をここで確認できます。")}
                </p>
              </>
            )}
          </aside>
        </section>
        <section className="production-grid production-setup-grid">
          <article className="production-card blueprint-card">
            <div className="production-card-head">
              <span>{t("01 · 프로젝트 설계", "01 · PROJECT BLUEPRINT", "01 · 项目蓝图", "01 · プロジェクト設計")}</span>
              <em>{t("Cut Log EDL 자동 사용", "Uses Cut Log EDL automatically", "自动使用 Cut Log EDL", "Cut Log EDL を自動使用")}</em>
            </div>
            <label>
              {t("프로젝트 이름", "Project name", "项目名称", "プロジェクト名")}
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <div className="path-grid">
              <label>
                {t("원본 파일 (작업 공간 내부)", "Source file (inside workspace)", "原始文件(工作区内部)", "ソースファイル(ワークスペース内)")}
                <input
                  value={sourcePath}
                  onChange={(event) => setSourcePath(event.target.value)}
                  placeholder="inputs/source.mp4"
                />
              </label>
              <label>
                {t("MP4 결과 위치", "MP4 output location", "MP4 输出位置", "MP4 出力先")}
                <input
                  value={outputPath}
                  onChange={(event) => setOutputPath(event.target.value)}
                  placeholder="outputs/final-video.mp4"
                />
              </label>
            </div>
            <label>
              {t("Instagram 캡션", "Instagram caption", "Instagram 字幕", "Instagram キャプション")}
              <textarea
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                maxLength={2200}
              />
            </label>
            <p>
              {t("Cut Log에서 저장한 남길 구간·자막을 읽어 EDL로 넣습니다. 아직 없으면 기본 3개 컷을 사용합니다.", "Uses kept segments and captions saved in Cut Log to create the EDL. If there is none, it uses three starter cuts.", "读取 Cut Log 中保存的保留片段和字幕生成 EDL。如果还没有,则使用默认的 3 个初始剪辑。", "Cut Log に保存された採用区間・キャプションを読み取り、EDL として取り込みます。まだない場合は初期の 3 カットを使用します。")}
            </p>
            <button
              className="production-primary"
              onClick={() => void createProject()}
              disabled={busy}
            >
              {t("로컬 프로젝트 만들기", "Create local project", "创建本地项目", "ローカルプロジェクトを作成")}
            </button>
          </article>
          <article className="production-card local-status-card">
            <div className="production-card-head">
              <span>{t("로컬 서비스 상태", "LOCAL SERVICE STATUS", "本地服务状态", "ローカルサービス状態")}</span>
              <em>{health?.status ?? t("연결 안 됨", "not connected", "未连接", "未接続")}</em>
            </div>
            <dl>
              <div>
                <dt>{t("바인딩", "Binding", "绑定地址", "バインド")}</dt>
                <dd>
                  {health?.bind ?? "—"} <small>{t("외부 공개 없음", "not exposed externally", "不对外公开", "外部に公開されません")}</small>
                </dd>
              </div>
              <div>
                <dt>{t("데이터베이스", "Database", "数据库", "データベース")}</dt>
                <dd>{health ? t("SQLite · 이 기기 전용", "SQLite · local only", "SQLite · 仅限本设备", "SQLite · ローカル専用") : "—"}</dd>
              </div>
              <div>
                <dt>{t("MoviePy 렌더", "MoviePy render", "MoviePy 渲染", "MoviePy レンダー")}</dt>
                <dd className={health?.moviepy_installed ? "good" : ""}>
                  {health?.moviepy_installed ? t("준비됨", "Ready", "已就绪", "準備完了") : t("설치 필요", "Install needed", "需要安装", "インストールが必要")}
                </dd>
              </div>
              <div>
                <dt>{t("Instagram 자격증명", "Instagram credentials", "Instagram 凭证", "Instagram 認証情報")}</dt>
                <dd className={health?.credentials_configured ? "good" : ""}>
                  {health?.credentials_configured
                    ? t("로컬 .env에서 확인됨", "Found in local .env", "已在本地 .env 中找到", "ローカルの .env で確認済み")
                    : t("아직 설정 안 됨", "Not configured", "尚未设置", "未設定")}
                </dd>
              </div>
            </dl>
            <label className="token-field">
              {t("로컬 보호 토큰", "Local protection token", "本地保护令牌", "ローカル保護トークン")} {" "}
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder={t("필요한 경우 이 브라우저 탭에서만 입력", "Enter only in this browser tab if needed", "仅在需要时在这个浏览器标签页中输入", "必要な場合のみこのブラウザタブで入力")}
              />
            </label>
            <p>{t("토큰은 이 화면이나 SQLite에 저장되지 않습니다.", "Tokens are never saved in this screen or SQLite.", "令牌不会保存在这个界面或 SQLite 中。", "トークンはこの画面や SQLite に保存されません。")}</p>
          </article>
        </section>
        <FinishRack renderSettings={renderSettings} patchSettings={patchSettings} applyPreset={applyPreset} presets={presets} t={t} />
        <section className="production-grid production-action-grid">
          <article className="production-card lane-card">
            <div className="production-card-head">
              <span>{t("02 · 렌더 작업", "02 · RENDER LANE", "02 · 渲染任务", "02 · レンダーレーン")}</span>
              <em>
                MoviePy · H.264/AAC ·{" "}
                {presets?.platform_presets[renderSettings.platform]
                  ? `${presets.platform_presets[renderSettings.platform].width}×${presets.platform_presets[renderSettings.platform].height}`
                  : "1080×1920"}
              </em>
            </div>
            <h2>{t("승인된 EDL을 로컬 MP4로 렌더", "Render an approved EDL as local MP4", "把已批准的 EDL 渲染为本地 MP4", "承認済みの EDL をローカル MP4 にレンダー")}</h2>
            <p>
              {t("작업 생성만으로 렌더는 시작되지 않습니다. 실행 버튼을 한 번 더 눌러야 하며, 실패·완료 결과도 로컬 이력에 남습니다.", "Creating a job does not start rendering. Run it separately; failures and completions remain in local history.", "仅创建任务不会开始渲染。需要再次点击执行按钮,失败和完成的结果都会留在本地历史中。", "ジョブを作成しただけではレンダーは始まりません。別途実行ボタンを押す必要があり、失敗・完了の結果はローカル履歴に残ります。")}
            </p>
            <label className="approval-check">
              <input
                type="checkbox"
                checked={approved}
                onChange={(event) => setApproved(event.target.checked)}
              />{" "}
              {t("이 편집 결정을 사람이 검토·승인했습니다.", "A person reviewed and approved this edit decision.", "这个剪辑决定已经由人工审核并批准。", "この編集判断は人がレビュー・承認しました。")}
            </label>
            <button
              className="production-primary"
              onClick={() => void queueRender()}
              disabled={busy || !selected}
            >
              {t("승인된 렌더 작업 대기열에 넣기", "Queue approved render job", "将已批准的渲染任务加入队列", "承認済みレンダージョブをキューに入れる")}
            </button>
            <small>
              {selectedProject
                ? t(`현재 프로젝트: ${selectedProject.title}`, `Current project: ${selectedProject.title}`, `当前项目:${selectedProject.title}`, `現在のプロジェクト:${selectedProject.title}`)
                : t("프로젝트를 만든 뒤 활성화됩니다.", "Available after you create a project.", "创建项目后即可使用。", "プロジェクトを作成すると利用できます。")}
            </small>
          </article>
          <article className="production-card lane-card instagram-card">
            <div className="production-card-head">
              <span>{t("03 · Instagram 게시", "03 · INSTAGRAM LANE", "03 · Instagram 发布", "03 · Instagram レーン")}</span>
              <em>{t("전문 계정 전용", "Professional account only", "仅限专业账号", "プロアカウント専用")}</em>
            </div>
            <h2>{t("자동 업로드 여부를 정하고 게시", "Choose auto-upload, then publish", "决定是否自动上传后发布", "自動アップロードの可否を決めて公開")}</h2>
            <p>
              {t("자동 업로드를 켜면 대기열에 추가하는 즉시 로컬 Instagram 자격증명으로 업로드를 시작합니다. 끄면 작업 보드에서 필요할 때 직접 실행합니다.", "When auto-upload is on, the upload starts with local Instagram credentials as soon as it is queued. When it is off, run the queued job from the job board when ready.", "开启自动上传后,一旦加入队列就会立即用本地 Instagram 凭证开始上传。关闭时,可以在需要时从任务看板直接执行。", "自動アップロードを有効にすると、キューに入れた時点でローカルの Instagram 認証情報を使ってアップロードが始まります。無効の場合は、必要なときにジョブボードから直接実行します。")}
            </p>
            <label className="approval-check">
              <input
                type="checkbox"
                checked={shareToFeed}
                onChange={(event) => setShareToFeed(event.target.checked)}
              />{" "}
              {t("릴을 프로필 피드에도 공유", "Also share the reel to the profile feed", "同时把 Reel 分享到主页动态", "リールをプロフィールフィードにも共有")}
            </label>
            <label className="approval-check">
              <input
                type="checkbox"
                checked={autoUpload}
                onChange={(event) => setAutoUpload(event.target.checked)}
              />{" "}
              {t("대기열 추가 후 Instagram 자동 업로드", "Auto-upload to Instagram after queueing", "加入队列后自动上传到 Instagram", "キュー追加後に Instagram へ自動アップロード")}
            </label>
            <button
              className="production-outline"
              onClick={() => void queueInstagram()}
              disabled={busy || !selected}
            >
              {autoUpload ? t("Instagram 자동 업로드 시작", "Start Instagram auto-upload", "开始 Instagram 自动上传", "Instagram 自動アップロードを開始") : t("Instagram 업로드 작업 대기열에 넣기", "Queue Instagram upload", "将 Instagram 上传任务加入队列", "Instagram アップロードをキューに入れる")}
            </button>
          </article>
        </section>
        <section className="production-jobs">
          <div className="production-section-head">
            <div>
              <p className="kicker">{t("로컬 작업 보드", "LOCAL JOB BOARD", "本地任务看板", "ローカルジョブボード")}</p>
              <h2>
                {t("브라우저에서는 사람이", "In the browser, a person", "在浏览器中由人来", "ブラウザでは人が")} <span>{t("실행을 허용", "allows execution", "允许执行", "実行を許可")}</span>{t("하고, 봇은 정책에 따라 자동화합니다.", ", while bots automate according to their policy.", ",机器人则按各自的策略自动化处理。", "し、ボットは自身のポリシーに従って自動化します。")}
              </h2>
            </div>
            <span>{t(`${jobs.length}개 작업`, `${jobs.length} total jobs`, `共 ${jobs.length} 个任务`, `合計 ${jobs.length} 件のジョブ`)}</span>
          </div>
          <div className="job-layout">
            <div className="project-list">
              {projects.length ? (
                projects.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => setSelected(project.id)}
                    className={selected === project.id ? "chosen" : ""}
                  >
                    <b>{project.title}</b>
                    <span>
                      {t(`${project.timeline_json.clips.length}개 컷`, `${project.timeline_json.clips.length} clips`, `${project.timeline_json.clips.length} 个片段`, `${project.timeline_json.clips.length} クリップ`)} ·{" "}
                      {stamp(project.created_at, language)}
                    </span>
                    <i>{project.id.slice(0, 8)}</i>
                  </button>
                ))
              ) : (
                <div className="empty-job">
                  {t("아직 로컬 프로젝트가 없습니다.", "There are no local projects yet.", "还没有本地项目。", "まだローカルプロジェクトがありません。")}
                  <br />
                  {t("위에서 첫 프로젝트를 만드세요.", "Create your first project above.", "请在上方创建第一个项目。", "上で最初のプロジェクトを作成してください。")}
                </div>
              )}
            </div>
            <div className="job-list">
              {selected ? (
                selectedJobs.length ? (
                  selectedJobs.map((job) => (
                    <article key={job.id} className={`job-row ${job.status}`}>
                      <div>
                        <span>
                          {job.kind === "render" ? "RENDER" : "INSTAGRAM"}
                        </span>
                        <b>{job.status.toUpperCase()}</b>
                        <p>
                          {stamp(job.created_at, language)} ·{" "}
                          {job.kind === "render"
                            ? t("로컬 렌더 승인", "local render authorization", "本地渲染批准", "ローカルレンダー承認")
                            : t("자동 업로드", "auto-upload", "自动上传", "自動アップロード")}{" "}
                          {job.approved ? t("기록됨", "recorded", "已记录", "記録済み") : t("누락", "missing", "缺失", "未記録")}
                        </p>
                        {job.error_text && <small>{job.error_text}</small>}
                        {job.status === "running" && (
                          <progress value={job.progress ?? 0} max={100} />
                        )}
                      </div>
                      <div className="job-row-actions">
                        <button
                          onClick={() => void runJob(job)}
                          disabled={
                            busy ||
                            (job.kind === "render" && !job.approved) ||
                            !["queued", "failed"].includes(job.status)
                          }
                        >
                          {job.kind === "instagram_publish"
                            ? t("업로드 실행", "Run upload", "执行上传", "アップロードを実行")
                            : t("렌더 실행", "Run render", "执行渲染", "レンダーを実行")}
                        </button>
                        {["queued", "running"].includes(job.status) && (
                          <button
                            className="job-cancel-button"
                            onClick={() => void cancelJob(job)}
                            disabled={Boolean(job.cancel_requested)}
                          >
                            {job.cancel_requested
                              ? t("취소 요청됨", "Cancel requested", "已请求取消", "キャンセル要求済み")
                              : t("취소", "Cancel", "取消", "キャンセル")}
                          </button>
                        )}
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty-job">
                    {t("선택한 프로젝트에는 아직 작업이 없습니다.", "The selected project has no jobs yet.", "所选项目还没有任务。", "選択したプロジェクトにはまだジョブがありません。")}
                    <br />
                    {t("렌더 또는 Instagram 게시에서 대기열을 만드세요.", "Create a queue in the Render or Instagram lane.", "请在渲染或 Instagram 发布中创建队列。", "レンダーまたは Instagram レーンでキューを作成してください。")}
                  </div>
                )
              ) : (
                <div className="empty-job">{t("왼쪽에서 프로젝트를 선택하세요.", "Choose a project on the left.", "请在左侧选择一个项目。", "左側でプロジェクトを選択してください。")}</div>
              )}
            </div>
          </div>
        </section>
        <section className="production-grid production-footer-grid">
          <article className="production-card bot-card">
            <div className="production-card-head">
              <span>{t("Grok 봇 범위", "GROK BOT BOUNDARY", "Grok 机器人边界", "Grok ボットの境界")}</span>
              <em>{t("제한된 로컬 계약", "narrow local contract", "受限的本地契约", "限定的なローカル契約")}</em>
            </div>
            <pre>{contract}</pre>
            <p>
              {t("봇은 프로젝트를 준비하고 렌더·Instagram 업로드 작업을 대기열에 넣거나 자동 실행할 수 있습니다. Meta 토큰이나 작업 공간 밖 파일에는 접근할 수 없습니다.", "Bots can prepare projects and queue or automatically run render and Instagram upload jobs. They cannot access Meta tokens or files outside the workspace.", "机器人可以准备项目,并将渲染、Instagram 上传任务加入队列或自动执行。无法访问 Meta 令牌或工作区之外的文件。", "ボットはプロジェクトを準備し、レンダー・Instagram アップロードジョブをキューに入れるか自動実行できます。Meta トークンやワークスペース外のファイルにはアクセスできません。")}
            </p>
          </article>
          <article className="production-card idea-card">
            <div className="production-card-head">
              <span>{t("적용한 제작 원칙", "ADOPTED PRODUCTION IDEAS", "已采用的制作理念", "採用した制作アイデア")}</span>
              <em>{t("조사 → 구현", "research → implementation", "调研 → 实现", "調査 → 実装")}</em>
            </div>
            <ul>
              <li>
                <b>Transcript → EDL → render</b>
                <span>
                  {t("영상 전체를 덤프하지 않고 선택한 말 구간만 렌더합니다.", "Render only the chosen speech segments instead of dumping the entire video.", "只渲染选定的语音片段,而不是整段视频。", "動画全体をそのまま使うのではなく、選んだ発話区間だけをレンダーします。")}
                </span>
              </li>
              <li>
                <b>{t("승인 조건", "Approval gates", "批准条件", "承認ゲート")}</b>
                <span>{t("렌더는 봇의 실행 정책을 따르고 Instagram 업로드는 프로젝트 자동 업로드 설정을 따릅니다.", "Rendering follows the bot execution policy and Instagram upload follows the project auto-upload setting.", "渲染遵循机器人的执行策略,Instagram 上传遵循项目的自动上传设置。", "レンダーはボットの実行ポリシーに従い、Instagram アップロードはプロジェクトの自動アップロード設定に従います。")}</span>
              </li>
              <li>
                <b>{t("지속되는 작업 기록", "Persistent job memory", "持久的任务记录", "永続的なジョブ記憶")}</b>
                <span>
                  {t("SQLite에 작업·실패·결과를 남겨 봇이 재시도와 상태 확인을 할 수 있습니다.", "Jobs, failures, and results remain in SQLite so bots can retry and check status.", "任务、失败和结果都保留在 SQLite 中,方便机器人重试和检查状态。", "ジョブ・失敗・結果は SQLite に残るため、ボットは再試行や状態確認ができます。")}
                </span>
              </li>
              <li>
                <b>{t("이어갈 수 있는 게시", "Resumable publishing", "可续传的发布", "再開可能な公開")}</b>
                <span>
                  {t("로컬 MP4를 컨테이너 업로드·처리 확인 뒤 게시합니다.", "Publish a local MP4 after container upload and processing checks.", "本地 MP4 会在容器上传和处理确认后再发布。", "ローカル MP4 はコンテナアップロードと処理確認の後に公開されます。")}
                </span>
              </li>
            </ul>
          </article>
        </section>
        <p className="production-message" aria-live="polite">
          {message}
        </p>
      </main>
    </>
  );
}
