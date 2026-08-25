"use client";

import Link from "next/link";
import { useLanguage } from "./language";
import { SiteHeader } from "./site-header";

const workspaces = [
  {
    href: "/production",
    index: "01",
    ko: "프로젝트 만들기",
    en: "Create a project",
    zh: "创建项目",
    ja: "プロジェクトを作る",
    koDetail:
      "원본 경로와 편집 구간을 넣고, 브라우저 승인 또는 봇의 자동 로컬 렌더를 준비합니다.",
    enDetail:
      "Add source paths and edit segments, then prepare browser-approved or bot-automatic local rendering.",
    zhDetail:
      "填入原始路径和剪辑区间,准备浏览器审批或机器人自动本地渲染。",
    jaDetail:
      "ソースパスと編集区間を入力し、ブラウザ承認またはボットによる自動ローカルレンダーを準備します。",
  },
  {
    href: "/operations",
    index: "02",
    ko: "편집안 검사하기",
    en: "Inspect the edit",
    zh: "检查剪辑方案",
    ja: "編集案を検査する",
    koDetail:
      "대본 컷 맵, 미디어 검사, QA, 브랜드 키트와 작업 보드를 한곳에서 관리합니다.",
    enDetail:
      "Manage cut maps, media inspection, QA, brand kits, and the task board in one place.",
    zhDetail:
      "在一处管理文字稿剪辑图、素材检查、QA、品牌套件和任务看板。",
    jaDetail:
      "文字起こしカットマップ、素材検査、QA、ブランドキット、作業ボードをひとまとめに管理します。",
  },
  {
    href: "/terminal",
    index: "03",
    ko: "봇 연결하기",
    en: "Connect a bot",
    zh: "连接机器人",
    ja: "ボットを接続する",
    koDetail: "복제본에 포함된 CLI로 봇을 입장시키고 로컬 작업을 시작합니다.",
    enDetail: "Use the included CLI to enter a bot and begin local work.",
    zhDetail: "使用克隆仓库自带的 CLI 让机器人入场并开始本地工作。",
    jaDetail: "クローンに含まれる CLI でボットを入場させ、ローカル作業を開始します。",
  },
];

const steps = [
  {
    ko: "로컬 작업 공간 시작",
    en: "Start the local workspace",
    zh: "启动本地工作区",
    ja: "ローカルワークスペースを起動",
    detailKo: "GitHub 복제본의 최상위 폴더에서 npm run local을 실행합니다.",
    detailEn: "Run npm run local from the top folder of the GitHub clone.",
    detailZh: "在 GitHub 克隆仓库的最上层文件夹运行 npm run local。",
    detailJa: "GitHub クローンのトップフォルダで npm run local を実行します。",
  },
  {
    ko: "프로젝트와 편집 방식 정하기",
    en: "Set the project and edit method",
    zh: "设定项目与剪辑方式",
    ja: "プロジェクトと編集方式を決める",
    detailKo:
      "Production에서 프로젝트를 만들고, 필요하면 봇이 편집 방식을 제안하게 합니다.",
    detailEn:
      "Create a project in Production, then let a bot propose an edit method if needed.",
    detailZh:
      "在 Production 中创建项目,需要时让机器人提出剪辑方式建议。",
    detailJa:
      "Production でプロジェクトを作成し、必要であればボットに編集方式を提案させます。",
  },
  {
    ko: "봇의 실행 정책 선택",
    en: "Choose a bot execution policy",
    zh: "选择机器人执行策略",
    ja: "ボットの実行ポリシーを選ぶ",
    detailKo:
      "입장한 봇은 기본 자동 로컬 렌더를 사용하거나 렌더마다 사람 승인을 받도록 바꿀 수 있습니다. Instagram 게시은 항상 사람이 결정합니다.",
    detailEn:
      "An entered bot defaults to automatic local rendering or can require a person for every render. Instagram upload can run automatically per project.",
    detailZh:
      "入场的机器人默认使用自动本地渲染,也可以改为每次渲染都需要人工批准。Instagram 发布可按项目设置自动上传。",
    detailJa:
      "入場したボットはデフォルトで自動ローカルレンダーを使用しますが、レンダーのたびに人の承認を必要とするよう変更もできます。Instagram への公開はプロジェクトごとの自動アップロード設定に従います。",
  },
];

export default function HomeConsole() {
  const { t } = useLanguage();
  return (
    <>
      <SiteHeader current="studio" />
      <main className="home-main">
        <section className="home-hero">
          <div>
            <p className="kicker">{t("로컬 비디오 작업 공간 · 봇 준비 완료", "LOCAL VIDEO WORKSPACE · BOT READY", "本地视频工作区 · 机器人就绪", "ローカル動画ワークスペース · ボット準備完了")}</p>
            <h1>
              {t("봇과 함께 만드는", "Make videos with", "和机器人一起", "ボットと一緒に")}
              <br />
              <span>
                {t("내 컴퓨터의 영상 제작실.", "bots on your own computer.", "在你自己的电脑上制作视频。", "あなたのパソコンで動画を作る。")}
              </span>
            </h1>
            <p>
              {t(
                "이 로컬 작업 공간에서 영상 편집 계획·검사·렌더 대기열을 한 곳에서 다룹니다. 파일과 기록은 이 기기에만 남고, 봇은 승인 범위 안에서만 작업합니다.",
                "This local workspace brings video edit planning, checks, and render queues together. Files and records stay on this device, and bots work only within approved boundaries.",
                "这个本地工作区把视频剪辑规划、检查和渲染队列汇总在一处。文件和记录只留在这台设备上,机器人只在获批的范围内工作。",
                "このローカルワークスペースでは、動画編集の計画・チェック・レンダーキューをひとつにまとめて扱います。ファイルと記録はこの端末だけに残り、ボットは承認された範囲内でのみ作業します。",
              )}
            </p>
            <div className="home-hero-actions">
              <Link href="/production">
                {t("첫 프로젝트 만들기", "Create your first project", "创建第一个项目", "最初のプロジェクトを作る")} →
              </Link>
              <Link href="/terminal" className="home-secondary-action">
                {t("봇 터미널 열기", "Open bot terminal", "打开机器人终端", "ボットターミナルを開く")}
              </Link>
            </div>
          </div>
          <aside>
            <span>{t("이 기기 전용", "LOCAL ONLY", "仅限本设备", "この端末専用")}</span>
            <b>127.0.0.1</b>
            <p>
              {t(
                "외부 서버나 데이터베이스 없이 이 컴퓨터에서 실행됩니다.",
                "Runs on this computer without an external server or database.",
                "无需外部服务器或数据库,直接在这台电脑上运行。",
                "外部サーバーやデータベースなしに、このパソコンだけで動作します。",
              )}
            </p>
            <div>
              <i>01</i>
              <strong>{t("파일", "Files", "文件", "ファイル")}</strong>
              <em>{t("이 기기", "This device", "本设备", "この端末")}</em>
            </div>
            <div>
              <i>02</i>
              <strong>{t("봇 기록", "Bot records", "机器人记录", "ボット記録")}</strong>
              <em>SQLite</em>
            </div>
            <div>
              <i>03</i>
              <strong>{t("최종 승인", "Final approval", "最终批准", "最終承認")}</strong>
              <em>{t("사람", "Human", "人工", "人")}</em>
            </div>
          </aside>
        </section>
        <section className="home-start">
          <div className="home-section-head">
            <div>
              <p className="kicker">{t("여기서 시작", "START HERE", "从这里开始", "ここから始める")}</p>
              <h2>
                {t(
                  "처음이라면 이 순서로 시작하세요.",
                  "Start here if this is your first time.",
                  "第一次使用请按这个顺序开始。",
                  "初めての場合はこの順番で始めてください。",
                )}
              </h2>
            </div>
            <p>
              {t(
                "각 화면은 다음 작업으로 자연스럽게 이어집니다. 모든 단계는 나중에 다시 열어 이어서 할 수 있습니다.",
                "Each workspace leads naturally to the next step. You can return and continue any step later.",
                "每个界面都会自然引导到下一步。所有步骤都可以稍后再回来继续。",
                "各画面は自然に次の作業へつながります。どのステップも後で戻って続けられます。",
              )}
            </p>
          </div>
          <div className="home-step-grid">
            {steps.map((step, index) => (
              <article key={step.en}>
                <i>{String(index + 1).padStart(2, "0")}</i>
                <div>
                  <b>{t(step.ko, step.en, step.zh, step.ja)}</b>
                  <p>{t(step.detailKo, step.detailEn, step.detailZh, step.detailJa)}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="home-workspaces">
          <div className="home-section-head">
            <div>
              <p className="kicker">{t("작업 공간", "WORKSPACES", "工作区", "ワークスペース")}</p>
              <h2>
                {t(
                  "무엇을 하려는지에 맞춰 들어가세요.",
                  "Open the workspace that matches your next job.",
                  "根据你要做的事情进入对应的工作区。",
                  "やりたいことに合わせてワークスペースを開きましょう。",
                )}
              </h2>
            </div>
            <p>
              {t(
                "복잡한 메뉴를 모두 알 필요가 없습니다. 아래 세 곳에서 대부분의 작업을 시작할 수 있습니다.",
                "You do not need to learn every menu. Most work begins in one of these three places.",
                "不需要了解所有复杂的菜单。大多数工作都可以从下面这三个地方开始。",
                "複雑なメニューをすべて覚える必要はありません。ほとんどの作業はこの 3 か所のどれかから始められます。",
              )}
            </p>
          </div>
          <div className="home-workspace-grid">
            {workspaces.map((space) => (
              <Link href={space.href} key={space.href}>
                <i>{space.index}</i>
                <b>{t(space.ko, space.en, space.zh, space.ja)}</b>
                <p>{t(space.koDetail, space.enDetail, space.zhDetail, space.jaDetail)}</p>
                <span>{t("열기", "Open", "打开", "開く")} →</span>
              </Link>
            ))}
          </div>
        </section>
        <section className="home-safety">
          <b>{t("봇이 할 수 있는 일", "What bots can do", "机器人能做的事", "ボットができること")}</b>
          <p>
            {t(
              "입장한 봇은 프로젝트·컷 맵·검사·작업 보드·편집 방식과 로컬 렌더를 사용합니다. 렌더는 봇별로 자동 또는 사람 승인 모드를 선택하고, Instagram 업로드는 프로젝트별 자동 업로드 설정을 따릅니다.",
              "Entered bots use projects, cut maps, checks, task boards, edit methods, and local rendering. Each bot chooses automatic or human-approved rendering; Instagram upload follows each project's auto-upload setting.",
              "入场的机器人会使用项目、剪辑图、检查、任务看板、剪辑方式和本地渲染。每个机器人可以选择自动或人工批准的渲染模式,Instagram 上传则遵循每个项目各自的自动上传设置。",
              "入場したボットはプロジェクト・カットマップ・検査・作業ボード・編集方式・ローカルレンダーを使用します。レンダーはボットごとに自動または人による承認モードを選び、Instagram アップロードはプロジェクトごとの自動アップロード設定に従います。",
            )}
          </p>
          <Link href="/bot-guide">
            {t("봇 작업 설명서 보기", "Read the bot guide", "查看机器人操作说明", "ボットガイドを読む")} →
          </Link>
        </section>
      </main>
    </>
  );
}
