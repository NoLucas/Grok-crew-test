"use client";

import { useCallback, useEffect, useState } from "react";
import { useLanguage, type AppLanguage } from "./language";
import { SiteHeader } from "./site-header";

type ExecutionPolicy = {
  mode: "auto_local" | "approval_required";
  updated_by: string;
  updated_at: string | null;
  is_default?: boolean;
};
type Bot = {
  bot_id: string;
  display_name: string;
  last_action: string;
  last_detail_json: Record<string, unknown>;
  last_seen: string;
  presence: "active" | "idle";
  seconds_since_checkin: number;
  execution_policy?: ExecutionPolicy;
};
type Activity = {
  id: string;
  bot_id: string;
  action: string;
  detail_json: Record<string, unknown>;
  created_at: string;
};
type BotSummary = {
  total_known: number;
  active_now: number;
  activity_rule: string;
};
type Health = {
  status: string;
  bind: string;
  moviepy_installed: boolean;
  instagram_publish_enabled: boolean;
  bots?: BotSummary;
};
type BotEntryGuide = {
  schema: string;
  scope: string;
  entry_endpoint: string;
  entry_body: Record<string, string>;
  first_requests: string[];
  keep_alive: string;
  approval_boundary: string;
};
type BotEntry = {
  id: string;
  bot_id: string;
  display_name: string;
  purpose: string;
  task: string;
  joined_at: string;
  presence: "active" | "idle";
  seconds_since_checkin: number | null;
};

const studio = "http://127.0.0.1:7214";
const capabilities = [
  {
    ko: "편집 계획 작성",
    en: "Edit planning",
    zh: "制定编辑计划",
    ja: "編集計画の作成",
    detailKo:
      "Cut Log의 자막·타임코드를 읽고, 남길 구간과 순서를 EDL로 준비합니다.",
    detailEn:
      "Read Cut Log captions and timecodes, then prepare the kept segments and order as an EDL.",
    detailZh:
      "读取 Cut Log 的字幕和时间码,把要保留的片段和顺序整理成 EDL。",
    detailJa:
      "Cut Log の字幕とタイムコードを読み、残す区間と順序を EDL として準備します。",
    mode: "auto",
  },
  {
    ko: "로컬 프로젝트 생성",
    en: "Create a local project",
    zh: "创建本地项目",
    ja: "ローカルプロジェクトを作成",
    detailKo: "원본·결과 파일 경로, 캡션, EDL을 SQLite 프로젝트로 기록합니다.",
    detailEn:
      "Record source and output paths, captions, and EDLs as SQLite projects.",
    detailZh:
      "把原始·输出文件路径、字幕和 EDL 记录为 SQLite 项目。",
    detailJa:
      "ソース・出力ファイルのパス、キャプション、EDL を SQLite プロジェクトとして記録します。",
    mode: "auto",
  },
  {
    ko: "작업 상태 읽기",
    en: "Read job status",
    zh: "读取任务状态",
    ja: "ジョブ状態を読む",
    detailKo:
      "프로젝트·렌더·게시 작업의 대기, 실패, 완료 상태를 확인해 다음 행동을 정합니다.",
    detailEn:
      "Check queued, failed, and complete project, render, and publish work to determine the next action.",
    detailZh:
      "确认项目、渲染、发布任务的排队、失败、完成状态,以决定下一步行动。",
    detailJa:
      "プロジェクト・レンダー・公開作業の待機・失敗・完了状態を確認し、次の行動を決めます。",
    mode: "auto",
  },
  {
    ko: "품질 확인 제안",
    en: "Suggest quality checks",
    zh: "建议质量检查",
    ja: "品質チェックを提案",
    detailKo:
      "빈 구간, 짧은 훅, 자막 길이, 릴 형식 문제를 찾아 수정안을 남깁니다.",
    detailEn:
      "Find empty segments, weak hooks, caption-length, and reel-format issues, then record fixes.",
    detailZh:
      "发现空白片段、薄弱的钩子、字幕长度和 Reel 格式问题,并记录修改建议。",
    detailJa:
      "空白区間、弱いフック、字幕の長さ、リール形式の問題を見つけ、修正案を記録します。",
    mode: "auto",
  },
  {
    ko: "렌더 작업 대기열",
    en: "Queue a render",
    zh: "加入渲染队列",
    ja: "レンダーをキューに入れる",
    detailKo:
      "연결된 봇은 자신의 정책을 auto_local 또는 사람 승인 필요로 정합니다. 기본값은 자동 로컬 렌더입니다.",
    detailEn:
      "A connected bot chooses auto_local or human approval. The default is automatic local rendering.",
    detailZh:
      "连接的机器人自行选择 auto_local 或需要人工批准的策略。默认值是自动本地渲染。",
    detailJa:
      "接続されたボットは自分のポリシーを auto_local か人による承認必須かで決めます。デフォルトは自動ローカルレンダーです。",
    mode: "auto",
  },
  {
    ko: "로컬 MP4 렌더 실행",
    en: "Run a local MP4 render",
    zh: "执行本地 MP4 渲染",
    ja: "ローカル MP4 レンダーを実行",
    detailKo:
      "auto_local 봇은 이 PC에서 9:16 H.264/AAC MP4를 바로 만들고, 승인 모드 봇은 사람 승인 뒤 실행합니다.",
    detailEn:
      "auto_local bots make a 9:16 H.264/AAC MP4 on this computer right away; approval-mode bots wait for a person.",
    detailZh:
      "auto_local 机器人会立即在这台电脑上生成 9:16 的 H.264/AAC MP4;审批模式的机器人则等待人工批准后再执行。",
    detailJa:
      "auto_local ボットはこの PC で 9:16 の H.264/AAC MP4 をすぐに作成し、承認モードのボットは人の承認を待ってから実行します。",
    mode: "auto",
  },
  {
    ko: "Instagram 게시 준비",
    en: "Prepare Instagram publishing",
    zh: "准备 Instagram 发布",
    ja: "Instagram 公開の準備",
    detailKo: "캡션·공유 여부·완성 MP4를 게시 대기열로 넣습니다.",
    detailEn:
      "Add the caption, share option, and final MP4 to a publish queue.",
    detailZh:
      "把字幕、是否分享和最终 MP4 加入发布队列。",
    detailJa:
      "キャプション・共有可否・完成 MP4 を公開キューに追加します。",
    mode: "review",
  },
  {
    ko: "Instagram 실제 게시",
    en: "Publish to Instagram",
    zh: "正式发布到 Instagram",
    ja: "Instagram に公開",
    detailKo:
      "자동 업로드가 켜진 작업은 즉시 전송하고, 꺼진 작업은 대기열에서 직접 실행합니다.",
    detailEn:
      "Jobs with auto-upload run immediately; queued jobs can be run directly from the job board.",
    detailZh:
      "开启自动上传的任务会立即发送,未开启的任务则从任务看板直接执行。",
    detailJa:
      "自動アップロードが有効なジョブは即座に送信され、無効なジョブはジョブボードから直接実行できます。",
    mode: "auto",
  },
  {
    ko: "작업 이력 요약",
    en: "Summarize job history",
    zh: "总结任务历史",
    ja: "ジョブ履歴の要約",
    detailKo:
      "실패 원인·결과물 위치·마지막 작업을 짧은 운영 보고로 정리합니다.",
    detailEn:
      "Summarize failures, output locations, and the last action as a concise operations report.",
    detailZh:
      "把失败原因、产出位置和最后一次操作整理成简短的运营报告。",
    detailJa:
      "失敗原因・成果物の場所・最後の操作を簡潔な運用レポートにまとめます。",
    mode: "auto",
  },
  {
    ko: "자격증명 보호",
    en: "Protect credentials",
    zh: "保护凭证",
    ja: "認証情報の保護",
    detailKo:
      "Meta 토큰, 로컬 보호 토큰, .env 파일을 읽거나 노출할 수 없습니다.",
    detailEn:
      "Never read or reveal Meta tokens, local protection tokens, or .env files.",
    detailZh:
      "不得读取或泄露 Meta 令牌、本地保护令牌或 .env 文件。",
    detailJa:
      "Meta トークン、ローカル保護トークン、.env ファイルを読み取ったり公開したりしてはいけません。",
    mode: "never",
  },
];

function dateTime(value: string, language: AppLanguage) {
  const locale = language === "ko" ? "ko-KR" : language === "zh" ? "zh-CN" : language === "ja" ? "ja-JP" : "en-US";
  return new Date(value).toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
function since(seconds: number, language: AppLanguage) {
  if (language === "en")
    return seconds < 60
      ? `${seconds}s ago`
      : seconds < 3600
        ? `${Math.floor(seconds / 60)}m ago`
        : `${Math.floor(seconds / 3600)}h ago`;
  if (language === "zh")
    return seconds < 60
      ? `${seconds}秒前`
      : seconds < 3600
        ? `${Math.floor(seconds / 60)}分钟前`
        : `${Math.floor(seconds / 3600)}小时前`;
  if (language === "ja")
    return seconds < 60
      ? `${seconds}秒前`
      : seconds < 3600
        ? `${Math.floor(seconds / 60)}分前`
        : `${Math.floor(seconds / 3600)}時間前`;
  return seconds < 60
    ? `${seconds}초 전`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}분 전`
      : `${Math.floor(seconds / 3600)}시간 전`;
}

export default function BotStatusConsole() {
  const { t, language } = useLanguage();
  const [health, setHealth] = useState<Health | null>(null);
  const [bots, setBots] = useState<Bot[]>([]);
  const [summary, setSummary] = useState<BotSummary | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [entryGuide, setEntryGuide] = useState<BotEntryGuide | null>(null);
  const [entries, setEntries] = useState<BotEntry[]>([]);
  const [message, setMessage] = useState("");
  const [lastRefresh, setLastRefresh] = useState("");
  const [copied, setCopied] = useState("");
  const [checking, setChecking] = useState(false);
  const [token, setToken] = useState("");
  const botRequest = `POST ${studio}/api/bots/heartbeat\nContent-Type: application/json\nAuthorization: Bearer <LOCAL_STUDIO_TOKEN if configured>\n\n{\n  "bot_id": "local-editor-bot",\n  "display_name": "Local Editor Bot",\n  "action": "cut_plan_ready",\n  "detail": { "project": "my-video-project", "next": "render or queue/auto-upload Instagram" }\n}`;
  const botEntryRequest = `POST ${studio}/api/bot-entry\nContent-Type: application/json\nAuthorization: Bearer <LOCAL_STUDIO_TOKEN if configured>\n\n{\n  "bot_id": "local-editor-bot",\n  "display_name": "Local Editor Bot",\n  "purpose": "edit_video",\n  "task": "Prepare a transcript-first local edit plan.",\n  "execution_mode": "auto_local"\n}`;

  const refresh = useCallback(async (quiet = false) => {
    setChecking(true);
    try {
      const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined;
      const [
        healthResponse,
        botResponse,
        activityResponse,
        entryResponse,
        entriesResponse,
      ] = await Promise.all([
        fetch(`${studio}/health`),
        fetch(`${studio}/api/bots`, { headers: authHeaders }),
        fetch(`${studio}/api/bot-activity`, { headers: authHeaders }),
        fetch(`${studio}/api/bot-entry`),
        fetch(`${studio}/api/bot-entries`, { headers: authHeaders }),
      ]);
      const [nextHealth, nextBots, nextActivity, nextEntryGuide, nextEntries] =
        (await Promise.all([
          healthResponse.json(),
          botResponse.json(),
          activityResponse.json(),
          entryResponse.json(),
          entriesResponse.json(),
        ])) as [
          Health,
          { bots?: Bot[]; summary?: BotSummary; error?: string },
          { activity?: Activity[]; error?: string },
          BotEntryGuide & { error?: string },
          { entries?: BotEntry[]; error?: string },
        ];
      if (
        !healthResponse.ok ||
        !botResponse.ok ||
        !activityResponse.ok ||
        !entryResponse.ok ||
        !entriesResponse.ok
      )
        throw new Error(
          nextBots.error ??
            nextActivity.error ??
            nextEntryGuide.error ??
            nextEntries.error ??
            t("로컬 서비스 응답 오류", "Local service response error", "本地服务响应错误", "ローカルサービス応答エラー"),
        );
      setHealth(nextHealth);
      setBots(nextBots.bots ?? []);
      setSummary(nextBots.summary ?? null);
      setActivity(nextActivity.activity ?? []);
      setEntryGuide(nextEntryGuide);
      setEntries(nextEntries.entries ?? []);
      setLastRefresh(new Date().toLocaleTimeString(language === "ko" ? "ko-KR" : "en-US"));
      if (!quiet)
        setMessage(
          (nextBots.summary?.active_now ?? 0)
            ? t(`${nextBots.summary?.active_now}개 봇이 최근 5분 안에 실제 체크인했습니다.`, `${nextBots.summary?.active_now} bot(s) checked in during the last five minutes.`, `最近 5 分钟内有 ${nextBots.summary?.active_now} 个机器人实际签到。`, `直近 5 分間で ${nextBots.summary?.active_now} 台のボットがチェックインしました。`)
            : t("최근 5분 안에 체크인한 봇이 없습니다. 아직 실제 사용 중이라고 확인된 봇은 없습니다.", "No bot has checked in during the last five minutes, so none is verified as in use yet.", "最近 5 分钟内没有机器人签到。目前还没有确认正在使用中的机器人。", "直近 5 分間にチェックインしたボットはいません。まだ実際に使用中と確認されたボットはありません。"),
        );
    } catch (error) {
      setHealth(null);
      setBots([]);
      setSummary(null);
      setActivity([]);
      setEntryGuide(null);
      setEntries([]);
      setMessage(
        error instanceof Error
          ? `${error.message} — ${t("Local Studio가 실행 중인지 확인하세요.", "Check that Local Studio is running.", "请确认 Local Studio 是否在运行。", "Local Studio が実行中か確認してください。")}`
          : t("Local Studio에 연결할 수 없습니다.", "Cannot connect to Local Studio.", "无法连接到 Local Studio。", "Local Studio に接続できません。"),
      );
    } finally {
      setChecking(false);
    }
  }, [language, t, token]);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refresh();
    }, 0);
    const interval = window.setInterval(() => {
      void refresh(true);
    }, 30000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [refresh]);
  const copyRequest = async (kind: "entry" | "heartbeat") => {
    await navigator.clipboard?.writeText(
      kind === "entry" ? botEntryRequest : botRequest,
    );
    setCopied(kind);
    window.setTimeout(() => setCopied(""), 1700);
  };
  const activityText = activity.map((item) => item.action.toLowerCase()).join(" ");
  const botFlow = [
    { id: "01", label: t("입장 기록", "Entry recorded", "已记录入场", "入場記録"), detail: t("봇 ID·표시명·목적을 보내고 첫 체크인을 남깁니다.", "The bot sends its ID, display name, purpose, and first check-in.", "机器人发送 ID、显示名和目的,并留下首次签到。", "ボットが ID・表示名・目的を送信し、最初のチェックインを残します。"), done: entries.length > 0 },
    { id: "02", label: t("활동 확인", "Activity verified", "已确认活动", "活動確認"), detail: t("heartbeat가 기록되면 이 화면에 활성 또는 대기 상태가 보입니다.", "A recorded heartbeat shows active or idle status here.", "记录了 heartbeat 后,这个界面会显示活跃或待机状态。", "heartbeat が記録されると、この画面に稼働中または待機状態が表示されます。"), done: bots.length > 0 || activity.length > 0 },
    { id: "03", label: t("편집 진행", "Editing in progress", "编辑进行中", "編集進行中"), detail: t("봇이 컷 맵·편집 방식·검사를 남기면 최근 활동에 표시됩니다.", "Cut maps, edit methods, and checks appear in recent activity.", "机器人留下剪辑图、剪辑方式或检查记录后,会显示在最近活动中。", "ボットがカットマップ・編集方式・検査を残すと、最近の活動に表示されます。"), done: /cut|edit|inspect|plan|project/.test(activityText) },
    { id: "04", label: t("렌더·업로드", "Render and upload", "渲染·上传", "レンダー・アップロード"), detail: t("렌더 또는 Instagram 업로드 기록이 남으면 마지막 단계가 완료됩니다.", "The final stage completes when a render or Instagram upload is recorded.", "留下渲染或 Instagram 上传记录后,最后一步就完成了。", "レンダーまたは Instagram アップロードの記録が残ると、最後のステップが完了します。"), done: /render|upload|instagram|publish/.test(activityText) },
  ];

  return (
    <>
      <SiteHeader current="bots" />
      <main className="bot-main">
        <section className="bot-hero">
          <div>
            <p className="kicker">{t("GROK CREW · 봇 확인", "GROK CREW · BOT CHECK", "GROK CREW · 机器人检查", "GROK CREW · ボット確認")}</p>
            <h1>
              {t("내 봇들이", "See what your bots", "看看我的机器人", "自分のボットが")}{" "}
              <span>{t("무엇을 하고 있는지", "are actually doing", "实际在做什么", "実際に何をしているか")}</span>
              <br />
              {t("확인 가능한 곳.", "on this computer.", "在这台电脑上确认。", "を確認できる場所。")}
            </h1>
            <p>
              {t(
                "이 화면은 추측으로 “봇이 접속했다”고 말하지 않습니다. 로컬 제작 서비스에 체크인을 남긴 봇만 표시하며, 최근 5분 이내의 기록만 활성 상태로 봅니다.",
                "This screen never guesses that a bot is present. It only shows bots that checked in to Local Studio, and counts activity from the last five minutes.",
                "这个界面不会凭猜测说“机器人已连接”。只显示在本地制作服务留下签到记录的机器人,并且只把最近 5 分钟内的记录视为活跃状态。",
                "この画面は推測で「ボットが接続している」とは言いません。ローカル制作サービスにチェックインを残したボットだけを表示し、直近 5 分以内の記録だけを稼働中とみなします。",
              )}
            </p>
          </div>
          <aside className={`bot-live-card ${health ? "ready" : ""}`}>
            <span>{t("실시간 상태", "LIVE ANSWER", "实时答案", "ライブアンサー")}</span>
            <b>
              {summary?.active_now
                ? t("예 · 활성 봇 확인", "YES · ACTIVE BOTS FOUND", "是 · 发现活跃机器人", "はい · アクティブボットあり")
                : health
                  ? t("아니요 · 확인된 봇 없음", "NO · NO VERIFIED BOT YET", "否 · 尚未确认任何机器人", "いいえ · 確認済みボットなし")
                  : t("서비스 꺼짐", "SERVICE OFFLINE", "服务已关闭", "サービス停止中")}
            </b>
            <p>
              {summary?.active_now
                ? t(
                    `${summary.active_now}개 봇이 로컬 서비스에 최근 체크인을 기록했습니다.`,
                    `${summary.active_now} bot(s) checked in to the local service recently.`,
                    `最近有 ${summary.active_now} 个机器人在本地服务中签到。`,
                    `最近 ${summary.active_now} 台のボットがローカルサービスにチェックインしました。`,
                  )
                : health
                  ? t(
                      "현재는 어떤 봇도 체크인하지 않았습니다. 브라우저를 열어 둔 것만으로는 사용 중으로 간주하지 않습니다.",
                      "No bot has checked in yet. Keeping a browser tab open is not treated as bot activity.",
                      "目前还没有任何机器人签到。仅仅打开浏览器标签页不算作机器人活动。",
                      "現在チェックインしたボットはいません。ブラウザタブを開いているだけではボット活動とはみなされません。",
                    )
                  : t(
                      "로컬 제작 서비스를 시작한 뒤 다시 확인하세요.",
                      "Start Local Studio, then check again.",
                      "启动本地制作服务后再重新确认。",
                      "Local Studio を起動してからもう一度確認してください。",
                    )}
            </p>
            <button onClick={() => void refresh()} disabled={checking}>
              {checking
                ? t("확인 중…", "Checking…", "确认中…", "確認中…")
                : t("지금 다시 확인", "Check now", "立即重新确认", "今すぐ確認")}
            </button>
            <label className="token-field">
              {t("로컬 보호 토큰", "Local protection token", "本地保护令牌", "ローカル保護トークン")}{" "}
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder={t("설정된 경우에만 입력", "Enter only if one is configured", "仅在已设置时输入", "設定されている場合のみ入力")}
              />
            </label>
          </aside>
        </section>
        <section className="bot-answer-strip">
          <b>{t("현재 확인 결과", "Current result", "当前确认结果", "現在の確認結果")}</b>
          <span>{message}</span>
          <em>{lastRefresh ? t(`마지막 확인 ${lastRefresh}`, `Last checked ${lastRefresh}`, `上次确认 ${lastRefresh}`, `最終確認 ${lastRefresh}`) : t("연결 대기", "Waiting for connection", "等待连接", "接続待ち")}</em>
        </section>
        <section className="bot-entry-panel">
          <div>
            <p className="kicker">{t("로컬 봇 입장", "LOCAL BOT ENTRY", "本地机器人入场", "ローカルボット入場")}</p>
            <h2>
              {t("Grok bot이", "A Grok bot can", "Grok bot 可以", "Grok bot は")} <span>{t("입장하고 바로 작업을 시작", "enter and start work immediately", "入场后立即开始作业", "入場してすぐに作業を開始")}</span>{t("할 수 있습니다.", ".", "。", "できます。")}
            </h2>
            <p>
              {t("같은 PC에서 실행되는 Grok bot은 입장 요청을 한 번 보내면 자동으로 첫 체크인이 기록됩니다. 입장한 봇은 모든 로컬 편집·검사·프로젝트·운영 기능을 곧바로 사용하며, 로컬 렌더는 기본 자동 실행 또는 사람 승인 모드 중 스스로 선택합니다.", "A Grok bot running on this computer records its first check-in when it sends one entry request. Entered bots can immediately use local editing, checks, projects, and operations, then choose automatic or human-approved local rendering.", "运行在同一台电脑上的 Grok bot,只要发送一次入场请求,就会自动记录首次签到。入场的机器人可以立即使用所有本地编辑、检查、项目和运营功能,并自行选择默认自动执行还是人工批准的本地渲染模式。", "この PC で動作する Grok bot は、入場リクエストを 1 回送るだけで自動的に最初のチェックインが記録されます。入場したボットはすべてのローカル編集・検査・プロジェクト・運用機能をすぐに使え、ローカルレンダーはデフォルトの自動実行か人による承認モードかを自分で選びます。")}
            </p>
            <div className="bot-entry-steps">
              <span>{t("01 · 입장 기록", "01 · Record entry", "01 · 记录入场", "01 · 入場記録")}</span>
              <span>{t("02 · 실행 정책 선택", "02 · Choose execution policy", "02 · 选择执行策略", "02 · 実行ポリシーを選択")}</span>
              <span>{t("03 · 편집·렌더 시작", "03 · Start editing and rendering", "03 · 开始编辑与渲染", "03 · 編集・レンダーを開始")}</span>
            </div>
          </div>
          <aside>
            <span>
              {entryGuide
                ? t("입장 준비됨 · 이 기기 전용", "ENTRY READY · LOCAL ONLY", "入场就绪 · 仅限本设备", "入場準備完了 · ローカル専用")
                : health
                  ? t("입장 정보 불러오는 중", "ENTRY LOADING", "正在加载入场信息", "入場情報を読み込み中")
                  : t("서비스 꺼짐", "SERVICE OFFLINE", "服务已关闭", "サービス停止中")}
            </span>
            <b>
              {entries.length
                ? t(`${entries.length}개의 입장 기록`, `${entries.length} entry record(s)`, `${entries.length} 条入场记录`, `${entries.length} 件の入場記録`)
                : t("아직 입장한 봇 없음", "No bot has entered yet", "还没有机器人入场", "まだ入場したボットはいません")}
            </b>
            <p>
              {entries[0]
                ? `${entries[0].display_name} · ${entries[0].purpose} · ${entries[0].presence.toUpperCase()}`
                : (entryGuide?.scope ??
                  t("Local Studio를 시작하면 입장 주소가 준비됩니다.", "Start Local Studio to make the entry address available.", "启动 Local Studio 后即可获得入场地址。", "Local Studio を起動すると入場アドレスが用意されます。"))}
            </p>
            <button onClick={() => void copyRequest("entry")}>
              {copied === "entry" ? t("입장 요청 복사됨", "Entry request copied", "入场请求已复制", "入場リクエストをコピーしました") : t("봇 입장 요청 복사", "Copy bot entry request", "复制机器人入场请求", "ボット入場リクエストをコピー")}
            </button>
            <small>
              {entryGuide?.approval_boundary ??
                t("기본 auto_local은 로컬 렌더에만 적용됩니다. Instagram 업로드는 작업별 자동 업로드 설정을 따릅니다.", "The default auto_local applies only to local renders. Instagram upload follows the per-job auto-upload setting.", "默认的 auto_local 只适用于本地渲染。Instagram 上传遵循每个任务各自的自动上传设置。", "デフォルトの auto_local はローカルレンダーにのみ適用されます。Instagram アップロードはジョブごとの自動アップロード設定に従います。")}
            </small>
          </aside>
        </section>
        <section className="bot-flow-panel">
          <div className="bot-flow-head">
            <div>
              <p className="kicker">{t("봇 접속 진행 상황", "BOT CONNECTION FLOW", "机器人接入进度", "ボット接続フロー")}</p>
              <h2>{t("봇이 들어온 뒤의 진행 상태를", "See each step after a bot enters,", "机器人入场后的每一步进度,", "ボットが入場した後の進捗を")} <span>{t("실제 기록으로 확인합니다.", "based on real local records.", "都以真实记录为准来确认。", "実際のローカル記録で確認します。")}</span></h2>
            </div>
            <p>{entries[0] ? t(`${entries[0].display_name}의 입장 기록과 활동을 기준으로 표시합니다.`, `Based on ${entries[0].display_name}'s entry record and activity.`, `以 ${entries[0].display_name} 的入场记录和活动为准显示。`, `${entries[0].display_name} の入場記録と活動を基準に表示します。`) : t("아직 입장 기록이 없습니다. 봇이 entry 요청을 보내면 첫 단계가 완료됩니다.", "There is no entry record yet. The first step completes when a bot sends an entry request.", "还没有入场记录。机器人发送 entry 请求后,第一步就会完成。", "まだ入場記録がありません。ボットが entry リクエストを送ると最初のステップが完了します。")}</p>
          </div>
          <div className="bot-flow-steps">
            {botFlow.map((step) => <article className={step.done ? "done" : "pending"} key={step.id}><i>{step.done ? "✓" : step.id}</i><div><b>{step.label}</b><p>{step.detail}</p></div><em>{step.done ? t("확인됨", "Verified", "已确认", "確認済み") : t("대기", "Waiting", "等待中", "待機中")}</em></article>)}
          </div>
        </section>
        <section className="bot-summary-grid">
          <article>
            <b>{summary?.total_known ?? 0}</b>
            <span>{t("등록된 로컬 봇", "Known local bots", "已知的本地机器人", "既知のローカルボット")}</span>
            <p>{t("체크인을 한 적 있는 봇 수", "Bots that have checked in", "曾经签到过的机器人数量", "チェックインしたことのあるボット数")}</p>
          </article>
          <article className={summary?.active_now ? "active" : ""}>
            <b>{summary?.active_now ?? 0}</b>
            <span>{t("현재 활성 봇", "Active bots now", "当前活跃机器人", "現在アクティブなボット")}</span>
            <p>{t("5분 이내 체크인 기준", "Checked in within five minutes", "以 5 分钟内签到为准", "5 分以内のチェックイン基準")}</p>
          </article>
          <article>
            <b>{activity.length}</b>
            <span>{t("최근 작업 기록", "Recent activity", "最近的活动记录", "最近のアクティビティ")}</span>
            <p>{t("로컬 SQLite의 봇 활동", "Bot activity in local SQLite", "本地 SQLite 中的机器人活动", "ローカル SQLite のボット活動")}</p>
          </article>
          <article className={health?.moviepy_installed ? "active" : ""}>
            <b>{health?.moviepy_installed ? "READY" : "CHECK"}</b>
            <span>{t("로컬 렌더", "Local rendering", "本地渲染", "ローカルレンダー")}</span>
            <p>{t("MoviePy 실행 가능 여부", "Whether MoviePy can run", "MoviePy 是否可以运行", "MoviePy が実行可能かどうか")}</p>
          </article>
        </section>
        <section className="bot-section bot-capability-section">
          <div className="bot-section-head">
            <div>
              <p className="kicker">{t("봇이 할 수 있는 일", "WHAT BOTS CAN DO", "机器人能做的事", "ボットができること")}</p>
              <h2>
                {t(
                  "봇에게 맡길 수 있는 일과",
                  "What you can delegate to bots,",
                  "可以交给机器人的事,",
                  "ボットに任せられることと、",
                )}
                <br />
                <span>
                  {t(
                    "사람이 반드시 결정할 일.",
                    "and what a person must decide.",
                    "以及必须由人来决定的事。",
                    "人が必ず決めるべきこと。",
                  )}
                </span>
              </h2>
            </div>
            <p>
              {t(
                "로컬 제작 서비스의 실제 권한을 기준으로 표시합니다.",
                "Based on the actual permissions of the local production service.",
                "以本地制作服务的实际权限为准显示。",
                "ローカル制作サービスの実際の権限を基準に表示します。",
              )}
            </p>
          </div>
          <div className="capability-list">
            {capabilities.map((capability, index) => (
              <article key={capability.en}>
                <i>{String(index + 1).padStart(2, "0")}</i>
                <div>
                  <b>{t(capability.ko, capability.en, capability.zh, capability.ja)}</b>
                  <p>{t(capability.detailKo, capability.detailEn, capability.detailZh, capability.detailJa)}</p>
                </div>
                <span
                  className={
                    capability.mode === "never"
                      ? "never"
                      : capability.mode === "auto"
                        ? "auto"
                        : "review"
                  }
                >
                  {capability.mode === "auto"
                    ? t("자동 가능", "Automatable", "可自动化", "自動化可能")
                    : capability.mode === "review"
                      ? t("사람 승인 필요", "Human approval required", "需要人工批准", "人による承認が必要")
                      : capability.mode === "triple"
                        ? t("3중 승인 필요", "Three approvals required", "需要三重批准", "3 段階の承認が必要")
                        : t("절대 금지", "Never allowed", "绝对禁止", "絶対禁止")}
                </span>
              </article>
            ))}
          </div>
        </section>
        <section className="bot-layout">
          <article className="bot-card bot-check-card">
            <div className="bot-card-head">
              <span>{t("확인된 봇 활동", "VERIFIED BOT PRESENCE", "已确认的机器人活动", "確認済みボットの活動")}</span>
              <em>
                {summary?.activity_rule ??
                  t("로컬 체크인만", "local check-in only", "仅本地签到", "ローカルチェックインのみ")}
              </em>
            </div>
            <h2>{t("실제로 사용하는 봇 목록", "Bots verified as in use", "已确认正在使用的机器人列表", "実際に使用中と確認されたボット一覧")}</h2>
            {bots.length ? (
              <div className="bot-presence-list">
                {bots.map((bot) => (
                  <article key={bot.bot_id}>
                    <div className={`presence-dot ${bot.presence}`} />
                    <div>
                      <b>{bot.display_name}</b>
                      <span>{bot.bot_id}</span>
                      <p>
                        {t("마지막 작업:", "Last action:", "最后操作:", "最終アクション:")}{" "}
                        <strong>{bot.last_action}</strong> ·{" "}
                        {since(bot.seconds_since_checkin, language)}
                      </p>
                      <p>
                        {t("로컬 렌더 정책:", "Local render policy:", "本地渲染策略:", "ローカルレンダーポリシー:")}{" "}
                        <strong>
                          {bot.execution_policy?.mode === "auto_local"
                            ? "AUTO LOCAL"
                            : "HUMAN APPROVAL"}
                        </strong>
                      </p>
                      <small>{JSON.stringify(bot.last_detail_json)}</small>
                    </div>
                    <em className={bot.presence}>
                      {bot.presence === "active" ? "ACTIVE" : "IDLE"}
                    </em>
                  </article>
                ))}
              </div>
            ) : (
              <div className="no-bot-state">
                <b>
                  {t("아직 입장한 봇이 없습니다.", "No bot has entered yet.", "还没有机器人入场。", "まだ入場したボットはいません。")}
                </b>
                <p>
                  {t(
                    "오류가 아닙니다. Grok bot의 로컬 실행 환경에 위 입장 요청을 넣으면 입장 기록과 첫 체크인이 함께 남고, 실제 활동만 이 목록에 표시됩니다.",
                    "This is not an error. Send the entry request above from a Grok bot on this computer to record entry and the first check-in; only real activity appears here.",
                    "这不是错误。在这台电脑上的 Grok bot 运行环境中发送上面的入场请求,就会同时留下入场记录和首次签到,这个列表只显示真实活动。",
                    "エラーではありません。この PC の Grok bot 実行環境から上記の入場リクエストを送ると、入場記録と最初のチェックインが一緒に残り、実際の活動だけがこの一覧に表示されます。",
                  )}
                </p>
              </div>
            )}
          </article>
          <article className="bot-card bot-automation-card">
            <div className="bot-card-head">
              <span>{t("자동화 정책", "AUTOMATION POLICY", "自动化策略", "自動化ポリシー")}</span>
              <em>{t("봇이 선택", "bot selected", "由机器人选择", "ボットが選択")}</em>
            </div>
            <h2>{t("봇이 로컬 렌더 허용 방식을 선택합니다", "Bots choose how local rendering is allowed", "机器人自行选择本地渲染的执行方式", "ボットがローカルレンダーの許可方式を選びます")}</h2>
            <div className="automation-rows">
              <div>
                <b>{t("기본: 자동 로컬", "Default: automatic local", "默认:自动本地", "デフォルト:自動ローカル")}</b>
                <p>
                  {t("입장한 봇은 계획·검사·프로젝트·운영과 자신의 로컬 렌더를 바로 실행할 수 있습니다.", "Entered bots can immediately use planning, checks, projects, operations, and their own local rendering.", "入场的机器人可以立即使用计划、检查、项目、运营功能以及自己的本地渲染。", "入場したボットは計画・検査・プロジェクト・運用、そして自分のローカルレンダーをすぐに実行できます。")}
                </p>
              </div>
              <div>
                <b>{t("선택: 사람 승인", "Optional: human approval", "可选:人工批准", "任意:人による承認")}</b>
                <p>
                  <code>
                    policy set --bot-id &lt;id&gt; --mode approval_required
                  </code>
                  {t("로 바꾸면 렌더마다 사람 승인을 요청합니다.", " to request a person’s approval for every render.", " 后,每次渲染都会请求人工批准。", " に変更すると、レンダーのたびに人の承認を求めます。")}
                </p>
              </div>
              <div>
                <b>{t("항상 사람 확인", "Always human-confirmed", "始终需要人工确认", "常に人による確認")}</b>
                <p>
                  {t("비밀값과 작업 공간 밖 파일", "Secrets and files outside the workspace", "密钥和工作区之外的文件", "シークレットとワークスペース外のファイル")}
                </p>
              </div>
            </div>
            <p className="automation-note">
              {t("Instagram 업로드는 각 작업의 자동 업로드 설정을 따릅니다. 자동 업로드를 끄면 작업 보드에서 직접 실행할 수 있습니다.", "Instagram upload follows each job's auto-upload setting. When it is off, run the job directly from the job board.", "Instagram 上传遵循每个任务各自的自动上传设置。关闭后可以在任务看板中直接执行。", "Instagram アップロードは各ジョブの自動アップロード設定に従います。オフの場合はジョブボードから直接実行できます。")}
            </p>
          </article>
        </section>
        <section className="bot-layout bot-bottom-layout">
          <article className="bot-card bot-contract-card">
            <div className="bot-card-head">
              <span>{t("봇 체크인 계약", "BOT CHECK-IN CONTRACT", "机器人签到契约", "ボットチェックイン契約")}</span>
              <button onClick={() => void copyRequest("heartbeat")}>
                {copied === "heartbeat" ? t("복사됨", "Copied", "已复制", "コピーしました") : t("체크인 요청 복사", "Copy check-in request", "复制签到请求", "チェックインリクエストをコピー")}
              </button>
            </div>
            <pre>{botRequest}</pre>
            <p>
              {t("봇은 작업을 시작·완료·대기 상태로 바꿀 때마다 이 체크인을 남깁니다. 보호 토큰을 켠 경우 토큰은 봇의 실행 환경에만 주입하고, 봇이 `.env`를 읽게 하면 안 됩니다.", "Bots record this check-in whenever work starts, completes, or waits. If a protection token is enabled, give it only to the bot runtime; the bot must not read .env.", "机器人在开始、完成或等待作业状态变化时都会留下这次签到。如果开启了保护令牌,只能注入到机器人的运行环境中,不能让机器人读取 `.env`。", "ボットは作業が開始・完了・待機状態に変わるたびにこのチェックインを残します。保護トークンを有効にした場合、トークンはボットの実行環境にのみ渡し、ボットに `.env` を読ませてはいけません。")}
            </p>
          </article>
          <article className="bot-card bot-activity-card">
            <div className="bot-card-head">
              <span>{t("최근 체크인", "RECENT CHECK-INS", "最近的签到", "最近のチェックイン")}</span>
              <em>
                {activity.length} {t("개 기록", "entries", "条记录", "件の記録")}
              </em>
            </div>
            {activity.length ? (
              <div className="bot-activity-list">
                {activity.map((item) => (
                  <article key={item.id}>
                    <b>{item.action}</b>
                    <span>{item.bot_id}</span>
                    <p>{dateTime(item.created_at, language)}</p>
                    <small>{JSON.stringify(item.detail_json)}</small>
                  </article>
                ))}
              </div>
            ) : (
              <div className="no-bot-state">
                <b>
                  {t(
                    "표시할 체크인이 없습니다.",
                    "There are no check-ins to show.",
                    "没有可显示的签到记录。",
                    "表示できるチェックインがありません。",
                  )}
                </b>
                <p>
                  {t(
                    "첫 봇이 heartbeat를 보내면 이곳에 시간·작업·세부 내용이 남습니다.",
                    "When the first bot sends a heartbeat, its time, work, and details appear here.",
                    "第一个机器人发送 heartbeat 后,时间、任务和详情会显示在这里。",
                    "最初のボットが heartbeat を送ると、時刻・作業・詳細がここに表示されます。",
                  )}
                </p>
              </div>
            )}
          </article>
        </section>
      </main>
    </>
  );
}
