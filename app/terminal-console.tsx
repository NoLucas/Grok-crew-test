"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLanguage } from "./language";
import { SiteHeader } from "./site-header";
import { useWorkspaceProfile } from "./workspace-profile";

type Health = {
  status: string;
  bind: string;
  moviepy_installed: boolean;
  bots?: { active_now: number };
};
const studio = "http://127.0.0.1:7214";
const productionUrl = "http://localhost:3000/production";
const cloneBootstrap = "python local_studio/grok_crew.py contract";

const powershellDownload =
  "Invoke-WebRequest http://127.0.0.1:7214/downloads/grok-crew.py -OutFile grok-crew.py; python grok-crew.py contract";
const shellDownload =
  "curl -fsS http://127.0.0.1:7214/downloads/grok-crew.py -o grok-crew.py && python3 grok-crew.py contract";
const commands = [
  {
    ko: "시작과 상태",
    en: "Start and status",
    zh: "启动与状态",
    ja: "開始とステータス",
    code: "health · contract · guide · site --page production · entry · policy get|set · heartbeat · bots list|activity|entries",
    detailKo:
      "로컬 서비스 상태를 읽고, 브라우저 작업 주소·봇 입장·실행 정책·활동 기록을 남깁니다.",
    detailEn:
      "Read local service status, browser workspace URLs, bot entry, execution policy, and activity records.",
    detailZh:
      "读取本地服务状态,记录浏览器工作区地址、机器人入场、执行策略和活动记录。",
    detailJa:
      "ローカルサービスの状態を読み取り、ブラウザワークスペースの URL・ボット入場・実行ポリシー・活動記録を残します。",
  },
  {
    ko: "프로젝트와 편집 방식",
    en: "Projects and edit method",
    zh: "项目与剪辑方式",
    ja: "プロジェクトと編集方式",
    code: "projects list|get|create · method get|set",
    detailKo: "프로젝트·EDL을 만들고 공유 편집 방식을 설정합니다.",
    detailEn: "Create projects and EDLs, then set the shared edit method.",
    detailZh: "创建项目和 EDL,并设置共享的剪辑方式。",
    detailJa: "プロジェクトと EDL を作成し、共有の編集方式を設定します。",
  },
  {
    ko: "P0–P2 운영",
    en: "P0–P2 operations",
    zh: "P0–P2 运营",
    ja: "P0–P2 運用",
    code: "ops show|inspect|cut-map|quality|artifact|update · brand list|save",
    detailKo:
      "대본 컷 맵, 검사, QA, 봇 작업, 메모, 오디오, 버전, 오버레이, 성과 기록을 사용합니다.",
    detailEn:
      "Use cut maps, inspection, QA, bot work, memory, audio, variants, overlays, and performance notes.",
    detailZh:
      "使用文字稿剪辑图、检查、QA、机器人任务、备忘、音频、版本、叠加层和成效记录。",
    detailJa:
      "文字起こしカットマップ、検査、QA、ボット作業、メモ、オーディオ、バリアント、オーバーレイ、成果記録を使用します。",
  },
  {
    ko: "로컬 렌더와 게시",
    en: "Local render and publishing",
    zh: "本地渲染与发布",
    ja: "ローカルレンダーと公開",
    code: "jobs list|render --bot-id · instagram · run",
    detailKo:
      "auto_local 봇은 로컬 렌더를 자동 실행하고, 승인 모드 봇은 사람 승인을 요청합니다. Instagram은 대기열에 넣거나 --auto-upload으로 즉시 업로드할 수 있습니다.",
    detailEn:
      "auto_local bots run local renders automatically; approval-mode bots request a person. Instagram jobs can be queued or uploaded immediately with --auto-upload.",
    detailZh:
      "auto_local 机器人会自动运行本地渲染,审批模式的机器人则会请求人工批准。Instagram 任务可以加入队列,也可以用 --auto-upload 立即上传。",
    detailJa:
      "auto_local ボットはローカルレンダーを自動実行し、承認モードのボットは人による承認を求めます。Instagram ジョブはキューに入れるか、--auto-upload で即座にアップロードできます。",
  },
];

export default function TerminalConsole() {
  const { t } = useLanguage();
  const { profile } = useWorkspaceProfile();
  const escapedBotLabel = profile.defaultBotLabel.replace(/["\\]/g, "\\$&");
  const firstEntry = `python local_studio/grok_crew.py entry --bot-id local-editor-bot --display-name "${escapedBotLabel}" --purpose edit_video --task "Prepare a transcript-first edit plan." --execution-mode auto_local`;
  const [health, setHealth] = useState<Health | null>(null);
  const [copied, setCopied] = useState("");
  const [message, setMessage] = useState("");
  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${studio}/health`);
      const value = (await response.json()) as Health & { error?: string };
      if (!response.ok)
        throw new Error(value.error ?? "local service unavailable");
      setHealth(value);
      setMessage(
        t(
          "Grok bot 터미널은 이 PC의 Local Studio에만 연결됩니다.",
          "Grok bot terminals connect only to Local Studio on this computer.",
          "Grok bot 终端只会连接到这台电脑上的 Local Studio。",
          "Grok bot ターミナルはこの PC の Local Studio にのみ接続します。",
        ),
      );
    } catch (error) {
      setHealth(null);
      setMessage(
        error instanceof Error
          ? `${error.message} — ${t("Local Studio를 먼저 실행하세요.", "Start Local Studio first.", "请先启动 Local Studio。", "先に Local Studio を起動してください。")}`
          : t(
              "Local Studio에 연결할 수 없습니다.",
              "Cannot connect to Local Studio.",
              "无法连接到 Local Studio。",
              "Local Studio に接続できません。",
            ),
      );
    }
  }, [t]);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [refresh]);
  const copy = async (name: string, value: string) => {
    await navigator.clipboard?.writeText(value);
    setCopied(name);
    window.setTimeout(() => setCopied(""), 1700);
  };

  return (
    <>
      <SiteHeader current="terminal" />
      <main className="terminal-main">
        <section className="terminal-hero">
          <div>
            <p className="kicker">{t("GROK CREW · 터미널 CLI", "GROK CREW · TERMINAL CLI", "GROK CREW · 终端 CLI", "GROK CREW · ターミナル CLI")}</p>
            <h1>
              {t("각 bot의 터미널에서", "Give every bot terminal", "在每个机器人的终端里", "各ボットのターミナルで")}
              <br />
              <span>
                {t(
                  "로컬 편집 도구를 실행하세요.",
                  "the complete local editor.",
                  "运行完整的本地编辑工具。",
                  "ローカル編集ツールを実行しましょう。",
                )}
              </span>
            </h1>
            <p>
              {t(
                "GitHub 복제본에는 봇 CLI가 이미 포함되어 있습니다. 이 PC의 각 터미널에서 입장·편집·검사·운영·승인된 전달 작업을 브라우저 없이 실행할 수 있습니다.",
                "Every GitHub clone already includes the bot CLI. Each terminal on this computer can run entry, editing, QA, operations, and approved delivery work without browser interaction.",
                "GitHub 克隆仓库中已经包含了机器人 CLI。这台电脑上的每个终端都可以在不打开浏览器的情况下完成入场、编辑、检查、运营和已批准的交付工作。",
                "GitHub クローンにはすでにボット CLI が含まれています。この PC の各ターミナルでは、ブラウザを使わずに入場・編集・検査・運用・承認済み配信作業を実行できます。",
              )}
            </p>
          </div>
          <aside className={`terminal-health ${health ? "ready" : ""}`}>
            <span>{t("로컬 CLI 연결", "LOCAL CLI GATEWAY", "本地 CLI 网关", "ローカル CLI ゲートウェイ")}</span>
            <b>
              {health
                ? t("연결 준비됨", "READY TO CONNECT", "可以连接", "接続準備完了")
                : t("서비스 꺼짐", "SERVICE OFFLINE", "服务已关闭", "サービス停止中")}
            </b>
            <p>
              {health
                ? `127.0.0.1 · ${health.moviepy_installed ? "MoviePy ready" : t("렌더 설정 필요", "render setup needed", "需要设置渲染", "レンダー設定が必要")} · ${health.bots?.active_now ?? 0} ${t("활성 봇", "active bot(s)", "个活跃机器人", "アクティブボット")}`
                : t(
                    "Local Studio를 실행하면 로컬 봇 연결이 준비됩니다.",
                    "Start Local Studio to make local bot connections available.",
                    "启动 Local Studio 后即可使用本地机器人连接。",
                    "Local Studio を起動するとローカルボット接続が使えるようになります。",
                  )}
            </p>
            <button onClick={() => void refresh()}>
              {t("연결 다시 확인", "Check connection", "重新检查连接", "接続を再確認")}
            </button>
          </aside>
        </section>
        <section className="terminal-rule">
          <b>{t("같은 PC 전용", "Same computer only", "仅限同一台电脑", "同一 PC 専用")}</b>
          <span>
            {t(
              "CLI는 127.0.0.1 또는 localhost 이외의 주소로 연결할 수 없습니다. 외부 Grok API·클라우드 서버·외부 데이터베이스는 사용하지 않습니다.",
              "The CLI can connect only to 127.0.0.1 or localhost. It uses no external Grok API, cloud server, or external database.",
              "CLI 无法连接到 127.0.0.1 或 localhost 以外的地址。不使用外部 Grok API、云服务器或外部数据库。",
              "CLI は 127.0.0.1 または localhost 以外のアドレスには接続できません。外部の Grok API・クラウドサーバー・外部データベースは使用しません。",
            )}
          </span>
        </section>
        <section className="terminal-port-map">
          <article>
            <span>{t("봇 CLI · JSON API", "BOT CLI · JSON API", "机器人 CLI · JSON API", "ボット CLI · JSON API")}</span>
            <b>127.0.0.1:7214</b>
            <p>
              {t(
                "다운로드·명령·데이터용 주소입니다. 이 주소에 /production 같은 화면 경로를 붙이지 마세요.",
                "Use this for downloads, commands, and data. Do not append browser paths such as /production.",
                "这是用于下载、命令和数据的地址。不要在这个地址后面加上 /production 之类的界面路径。",
                "これはダウンロード・コマンド・データ用のアドレスです。/production のような画面パスをこのアドレスに付け足さないでください。",
              )}
            </p>
          </article>
          <article>
            <span>{t("브라우저 작업 공간 · 스크린샷", "BROWSER WORKSPACE · SCREENSHOT", "浏览器工作区 · 截图", "ブラウザワークスペース · スクリーンショット")}</span>
            <b>localhost:3000</b>
            <p>
              {t(
                "화면 열기·스크린샷은 이 주소입니다. CLI에서는 site --page production으로 정확한 주소를 받습니다.",
                "Open pages and take screenshots here. In the CLI, use site --page production to print the exact URL.",
                "打开页面和截图请使用这个地址。在 CLI 中可以用 site --page production 获取准确地址。",
                "画面を開く・スクリーンショットを撮るにはこのアドレスを使います。CLI では site --page production で正確な URL を取得できます。",
              )}
            </p>
            <div>
              <code>{productionUrl}</code>
              <button
                onClick={() => void copy("production-url", productionUrl)}
              >
                {copied === "production-url"
                  ? t("복사됨", "Copied", "已复制", "コピーしました")
                  : t("편집 화면 주소 복사", "Copy editor URL", "复制编辑界面地址", "編集画面の URL をコピー")}
              </button>
            </div>
          </article>
        </section>
        <section className="terminal-clone">
          <div>
            <p className="kicker">{t("GitHub 복제본 · 내장 봇 CLI", "GITHUB CLONE · BUILT-IN BOT CLI", "GitHub 克隆仓库 · 内置机器人 CLI", "GitHub クローン · 内蔵ボット CLI")}</p>
            <h2>
              {t(
                "복제본에는 봇 CLI가 이미 들어 있습니다.",
                "Every clone already includes the bot CLI.",
                "克隆仓库中已经包含了机器人 CLI。",
                "クローンにはすでにボット CLI が含まれています。",
              )}
            </h2>
            <p>
              {t(
                "GitHub에서 내려받은 폴더의 최상위에서 실행하세요. 파일을 다시 내려받을 필요가 없으므로 구버전 CLI 혼동도 없습니다.",
                "Run this from the top folder of a GitHub clone. No additional download means no stale-CLI confusion.",
                "请在从 GitHub 下载的文件夹最上层运行。不需要再次下载文件,也就不会出现旧版 CLI 混用的问题。",
                "GitHub からダウンロードしたフォルダの最上位で実行してください。追加のダウンロードが不要なため、古い CLI との混同もありません。",
              )}
            </p>
          </div>
          <div>
            <code>{cloneBootstrap}</code>
            <button
              onClick={() => void copy("clone-bootstrap", cloneBootstrap)}
            >
              {copied === "clone-bootstrap"
                ? t("복사됨", "Copied", "已复制", "コピーしました")
                : t("복제본 CLI 명령 복사", "Copy clone CLI command", "复制克隆仓库 CLI 命令", "クローン CLI コマンドをコピー")}
            </button>
          </div>
        </section>
        <section className="terminal-download-grid">
          <article className="terminal-card">
            <div className="terminal-card-head">
              <span>01 · WINDOWS / POWERSHELL</span>
              <button
                onClick={() => void copy("powershell", powershellDownload)}
              >
                {copied === "powershell"
                  ? t("복사됨", "Copied", "已复制", "コピーしました")
                  : t("명령 복사", "Copy command", "复制命令", "コマンドをコピー")}
              </button>
            </div>
            <pre>{powershellDownload}</pre>
            <p>
              {t(
                "각 Grok bot 터미널에서 실행하면 현재 Local Studio가 제공하는 CLI를 내려받고 기능 계약을 확인합니다.",
                "Run this in a Grok bot terminal to download the current Local Studio CLI and inspect its capability contract.",
                "在各个 Grok bot 终端中运行,即可下载当前 Local Studio 提供的 CLI 并查看功能契约。",
                "各 Grok bot ターミナルで実行すると、現在の Local Studio が提供する CLI をダウンロードし、機能契約を確認できます。",
              )}
            </p>
          </article>
          <article className="terminal-card">
            <div className="terminal-card-head">
              <span>02 · MAC / LINUX SHELL</span>
              <button onClick={() => void copy("shell", shellDownload)}>
                {copied === "shell"
                  ? t("복사됨", "Copied", "已复制", "コピーしました")
                  : t("명령 복사", "Copy command", "复制命令", "コマンドをコピー")}
              </button>
            </div>
            <pre>{shellDownload}</pre>
            <p>
              {t(
                "같은 로컬 장치에서만 실행하세요. 원격 서버나 인터넷 주소로는 연결되지 않습니다.",
                "Run it only on the same local device. It cannot connect to a remote server or internet address.",
                "请只在同一台本地设备上运行。无法连接到远程服务器或互联网地址。",
                "同じローカル端末でのみ実行してください。リモートサーバーやインターネットアドレスには接続できません。",
              )}
            </p>
          </article>
        </section>
        <section className="terminal-flow">
          <div className="terminal-flow-head">
            <div>
              <p className="kicker">{t("봇 시작 순서", "BOT START SEQUENCE", "机器人启动顺序", "ボット開始手順")}</p>
              <h2>
                {t("내려받고 · 입장하고 ·", "Download · enter ·", "下载 · 入场 ·", "ダウンロード · 入場 ·")}{" "}
                <span>{t("작업을 이어갑니다.", "continue the work.", "继续作业。", "作業を続けます。")}</span>
              </h2>
            </div>
            <button onClick={() => void copy("entry", firstEntry)}>
              {copied === "entry"
                ? t("입장 명령 복사됨", "Entry command copied", "入场命令已复制", "入場コマンドをコピーしました")
                : t("첫 입장 명령 복사", "Copy first entry command", "复制首次入场命令", "最初の入場コマンドをコピー")}
            </button>
          </div>
          <pre>{firstEntry}</pre>
          <div className="terminal-flow-steps">
            <article>
              <i>01</i>
              <b>contract</b>
              <p>
                {t(
                  "CLI가 가진 모든 명령과 승인 규칙을 읽습니다.",
                  "Read every CLI command and approval rule.",
                  "读取 CLI 拥有的所有命令和批准规则。",
                  "CLI が持つすべてのコマンドと承認ルールを読み取ります。",
                )}
              </p>
            </article>
            <article>
              <i>02</i>
              <b>entry</b>
              <p>
                {t(
                  "봇 이름·목적·작업을 기록하고 첫 체크인을 남깁니다.",
                  "Record the bot name, purpose, task, and first check-in.",
                  "记录机器人名称、目的、任务,并留下首次签到。",
                  "ボット名・目的・タスクを記録し、最初のチェックインを残します。",
                )}
              </p>
            </article>
            <article>
              <i>03</i>
              <b>guide / ops</b>
              <p>
                {t(
                  "편집 설명서를 읽고 대본·검사·작업 보드로 진행합니다.",
                  "Read the guide, then continue with transcript, checks, and the task board.",
                  "阅读编辑说明书,然后继续处理文字稿、检查和任务看板。",
                  "編集マニュアルを読み、文字起こし・検査・作業ボードへ進みます。",
                )}
              </p>
            </article>
            <article>
              <i>04</i>
              <b>heartbeat</b>
              <p>
                {t(
                  "의미 있는 상태가 바뀔 때 활동 기록을 갱신합니다.",
                  "Update activity whenever a meaningful state changes.",
                  "在状态发生有意义的变化时更新活动记录。",
                  "意味のある状態変化があるたびに活動記録を更新します。",
                )}
              </p>
            </article>
          </div>
        </section>
        <section className="terminal-capabilities">
          <div className="terminal-section-head">
            <div>
              <p className="kicker">{t("전체 로컬 기능 목록", "FULL LOCAL CAPABILITY MAP", "完整本地功能列表", "全ローカル機能マップ")}</p>
              <h2>
                {t(
                  "브라우저 화면의 운영 기능을",
                  "Browser workspace operations,",
                  "把浏览器界面的运营功能,",
                  "ブラウザ画面の運用機能を",
                )}
                <br />
                <span>
                  {t(
                    "터미널에서도 같은 계약으로.",
                    "with the same terminal contract.",
                    "以同样的契约搬到终端上。",
                    "ターミナルでも同じ契約で。",
                  )}
                </span>
              </h2>
            </div>
            <p>
              {t(
                "복잡한 JSON 입력은 파일로 전달합니다. 예: --file project.json. CLI는 별도 패키지를 설치하지 않습니다.",
                "Pass complex JSON input as a file, for example --file project.json. The CLI has no extra package dependency.",
                "复杂的 JSON 输入通过文件传递,例如 --file project.json。CLI 不需要安装额外的软件包。",
                "複雑な JSON 入力はファイルで渡します。例:--file project.json。CLI に追加パッケージのインストールは不要です。",
              )}
            </p>
          </div>
          <div className="terminal-command-list">
            {commands.map((command, index) => (
              <article key={command.en}>
                <i>{String(index + 1).padStart(2, "0")}</i>
                <div>
                  <b>{t(command.ko, command.en, command.zh, command.ja)}</b>
                  <code>{command.code}</code>
                  <p>{t(command.detailKo, command.detailEn, command.detailZh, command.detailJa)}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="terminal-safety-grid">
          <article className="terminal-card token-card">
            <div className="terminal-card-head">
              <span>{t("로컬 토큰", "LOCAL TOKEN", "本地令牌", "ローカルトークン")}</span>
              <em>{t("선택 보호", "optional protection", "可选保护", "任意の保護")}</em>
            </div>
            <h3>
              {t(
                "토큰은 bot 터미널에만 둡니다.",
                "Keep tokens in the bot terminal only.",
                "令牌只保存在机器人终端中。",
                "トークンはボットターミナルにのみ保管します。",
              )}
            </h3>
            <p>
              {t(
                "보호 토큰을 켠 경우에만 각 터미널 환경 변수 LOCAL_STUDIO_TOKEN으로 전달하세요. CLI와 웹사이트, SQLite는 토큰을 저장하거나 읽지 않습니다.",
                "Only when token protection is enabled, pass LOCAL_STUDIO_TOKEN through each terminal environment. The CLI, website, and SQLite never store or read it.",
                "只有在开启令牌保护时,才需要通过各终端的环境变量 LOCAL_STUDIO_TOKEN 传递。CLI、网站和 SQLite 都不会存储或读取该令牌。",
                "トークン保護を有効にした場合のみ、各ターミナルの環境変数 LOCAL_STUDIO_TOKEN で渡してください。CLI・ウェブサイト・SQLite はこのトークンを保存も読み取りもしません。",
              )}
            </p>
            <button
              onClick={() =>
                void copy("contract", `${studio}/api/terminal-contract`)
              }
            >
              {copied === "contract"
                ? t("계약 주소 복사됨", "Contract address copied", "契约地址已复制", "契約アドレスをコピーしました")
                : t("터미널 계약 주소 복사", "Copy terminal contract URL", "复制终端契约地址", "ターミナル契約 URL をコピー")}
            </button>
          </article>
          <article className="terminal-card approval-card">
            <div className="terminal-card-head">
              <span>{t("봇 실행 정책", "BOT EXECUTION POLICY", "机器人执行策略", "ボット実行ポリシー")}</span>
              <em>{t("봇이 선택", "bot selected", "由机器人选择", "ボットが選択")}</em>
            </div>
            <h3>
              {t(
                "입장하면 기본으로 자동 로컬 렌더가 켜집니다.",
                "Entry enables automatic local rendering by default.",
                "入场后默认会开启自动本地渲染。",
                "入場するとデフォルトで自動ローカルレンダーが有効になります。",
              )}
            </h3>
            <p>
              {t(
                "policy set --bot-id &lt;id&gt; --mode approval_required로 바꾸면 그 봇의 렌더에는 --human-approved가 필요합니다. Instagram은 jobs instagram --auto-upload으로 바로 업로드하거나, 이 옵션 없이 대기열에 넣어 직접 실행할 수 있습니다.",
                "Use policy set --bot-id &lt;id&gt; --mode approval_required to require --human-approved for that bot. Use jobs instagram --auto-upload to upload immediately, or omit it to queue and run the job directly later.",
                "改用 policy set --bot-id &lt;id&gt; --mode approval_required 后,该机器人的渲染就需要 --human-approved。Instagram 可以用 jobs instagram --auto-upload 立即上传,或不加这个选项先加入队列再手动执行。",
                "policy set --bot-id &lt;id&gt; --mode approval_required に変更すると、そのボットのレンダーには --human-approved が必要になります。Instagram は jobs instagram --auto-upload で即座にアップロードするか、このオプションを省略してキューに入れ、後で直接実行できます。",
              )}
            </p>
          </article>
          <article className="terminal-card">
            <div className="terminal-card-head">
              <span>{t("실시간 상태", "LIVE STATUS", "实时状态", "ライブステータス")}</span>
              <em>
                {health ? t("연결됨", "connected", "已连接", "接続済み") : t("오프라인", "offline", "离线", "オフライン")}
              </em>
            </div>
            <h3>{t("현재 로컬 실행 상태", "Current local status", "当前本地运行状态", "現在のローカル実行状態")}</h3>
            <p>
              {message ||
                t(
                  "로컬 터미널 연결을 확인하는 중입니다.",
                  "Checking the local terminal connection.",
                  "正在检查本地终端连接。",
                  "ローカルターミナル接続を確認しています。",
                )}
            </p>
            <Link href="/bots">
              {t("봇 활동 확인으로 이동", "Open bot activity", "前往查看机器人活动", "ボット活動確認へ移動")} →
            </Link>
          </article>
        </section>
      </main>
    </>
  );
}
