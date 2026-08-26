"use client";

import { useEffect, useState } from "react";
import { SiteHeader } from "./site-header";
import {
  clearBrowserWorkspaceData,
  useWorkspaceProfile,
} from "./workspace-profile";
import { useLanguage } from "./language";

export default function PrivacyConsole() {
  const { t } = useLanguage();
  const { profile, save } = useWorkspaceProfile();
  const [workspaceName, setWorkspaceName] = useState(profile.workspaceName);
  const [botLabel, setBotLabel] = useState(profile.defaultBotLabel);
  const [message, setMessage] = useState("");
  // profile loads asynchronously (from localStorage, possibly via another
  // browser tab's edit) after this component's own initial render, and these
  // two fields are an independently-editable draft copy of it -- so this
  // effect intentionally re-syncs the draft whenever the upstream value
  // changes, rather than mirroring it once at mount.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWorkspaceName(profile.workspaceName);
    setBotLabel(profile.defaultBotLabel);
  }, [profile]);
  const saveProfile = () => {
    save({ workspaceName, defaultBotLabel: botLabel });
    setMessage(
      t(
        "이 기기의 브라우저에만 작업 공간 이름과 기본 봇 표시명이 저장되었습니다.",
        "The workspace name and default bot label were saved only in this browser on this device.",
        "工作区名称和默认机器人显示名仅保存在这台设备的浏览器中。",
        "ワークスペース名とデフォルトのボット表示名は、この端末のこのブラウザにのみ保存されました。",
      ),
    );
  };
  const erase = () => {
    if (
      !window.confirm(
        t(
          "이 브라우저에 저장한 편집 초안, 봇 응답, 이름 설정을 지울까요? 로컬 Studio의 미디어와 SQLite 기록은 지우지 않습니다.",
          "Remove saved browser drafts, bot responses, and names? This does not delete Local Studio media or SQLite records.",
          "要删除保存在这个浏览器中的编辑草稿、机器人回应和名称设置吗?这不会删除 Local Studio 的媒体和 SQLite 记录。",
          "このブラウザに保存された編集下書き、ボットの応答、名前設定を削除しますか? Local Studio のメディアと SQLite 記録は削除されません。",
        ),
      )
    )
      return;
    clearBrowserWorkspaceData();
    window.location.assign("/");
  };
  return (
    <>
      <SiteHeader current="privacy" />
      <main className="privacy-main">
        <section className="privacy-hero">
          <p className="kicker">{t("로컬 개인정보 보호 + 맞춤 설정", "LOCAL PRIVACY + PERSONALIZATION", "本地隐私保护 + 个性化设置", "ローカルプライバシー + カスタマイズ")}</p>
          <h1>
            {t("이름은 내가 정하고,", "Name the workspace yourself,", "名字由你自己来定,", "名前は自分で決めて、")}
            <br />
            <span>
              {t(
                "기록은 내 기기에만 둡니다.",
                "keep its records on your device.",
                "记录只留在你的设备上。",
                "記録はあなたの端末にだけ残す。",
              )}
            </span>
          </h1>
          <p>
            {t(
              "공용 화면에는 특정 사용자·봇·프로젝트의 이름을 기본값으로 넣지 않습니다. 여기서 정한 이름은 이 브라우저와 이 기기에만 저장됩니다.",
              "The shared interface has no default user, bot, or project identity. Names set here stay only in this browser on this device.",
              "共用界面不会预设特定用户、机器人或项目的名称。在这里设置的名称只保存在这个浏览器和这台设备上。",
              "共有画面には特定のユーザー・ボット・プロジェクトの名前をデフォルトで入れません。ここで決めた名前はこのブラウザとこの端末にのみ保存されます。",
            )}
          </p>
        </section>
        <section className="privacy-grid">
          <article className="privacy-card">
            <div className="privacy-card-head">
              <span>{t("작업 공간 이름", "WORKSPACE IDENTITY", "工作区名称", "ワークスペース識別")}</span>
              <em>{t("이 기기 전용", "this device only", "仅限本设备", "この端末専用")}</em>
            </div>
            <label>
              {t("작업 공간 이름", "Workspace name", "工作区名称", "ワークスペース名")}
              <input
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
                maxLength={80}
                placeholder={t("예: 내 영상 작업실", "e.g. My video workspace", "例如:我的视频工作室", "例:マイビデオワークスペース")}
              />
            </label>
            <label>
              {t("기본 봇 표시명", "Default bot label", "默认机器人显示名", "デフォルトのボット表示名")}
              <input
                value={botLabel}
                onChange={(event) => setBotLabel(event.target.value)}
                maxLength={80}
                placeholder={t("예: 로컬 편집 Agent", "e.g. Local Editor Agent", "例如:本地剪辑 Agent", "例:ローカル編集 Agent")}
              />
            </label>
            <button onClick={saveProfile}>
              {t("이 기기에만 저장", "Save on this device", "仅保存到本设备", "この端末にのみ保存")}
            </button>
            <p>
              {t(
                "실제 bot_id와 표시명은 봇이 입장할 때 직접 보냅니다. 이 기본 표시명은 안내용이며 서버·공유 사이트로 전송되지 않습니다.",
                "A real bot_id and display name are supplied by the bot at entry. This label is only for guidance and is never sent to a server or a shared site.",
                "真正的 bot_id 和显示名由机器人在入场时自行提供。这个默认显示名仅作提示用,不会发送到服务器或共享站点。",
                "実際の bot_id と表示名はボットが入場時に自分で送信します。このデフォルト表示名は案内用であり、サーバーや共有サイトには送信されません。",
              )}
            </p>
          </article>
          <article className="privacy-card privacy-boundary">
            <div className="privacy-card-head">
              <span>{t("데이터 범위", "DATA BOUNDARY", "数据范围", "データの境界")}</span>
              <em>{t("이 기기 전용", "LOCAL ONLY", "仅限本设备", "ローカル専用")}</em>
            </div>
            <ul>
              <li>
                {t(
                  "브라우저 초안·설정: 이 브라우저의 local storage",
                  "Browser drafts and settings: this browser’s local storage",
                  "浏览器草稿·设置:这个浏览器的 local storage",
                  "ブラウザの下書き・設定:このブラウザの local storage",
                )}
              </li>
              <li>
                {t(
                  "프로젝트·봇 작업 기록: 이 PC의 Local Studio SQLite",
                  "Project and bot records: Local Studio SQLite on this PC",
                  "项目·机器人工作记录:这台电脑上的 Local Studio SQLite",
                  "プロジェクト・ボット作業記録:この PC の Local Studio SQLite",
                )}
              </li>
              <li>
                {t(
                  "미디어: local_studio/workspace 내부의 로컬 파일",
                  "Media: local files under local_studio/workspace",
                  "媒体文件:local_studio/workspace 内部的本地文件",
                  "メディア:local_studio/workspace 内のローカルファイル",
                )}
              </li>
              <li>
                {t(
                  "기본값에 다른 사용자의 봇 이름·프로젝트·SNS 주소는 포함하지 않음",
                  "No other user’s bot name, project, or social link is included as a default",
                  "默认值中不包含其他用户的机器人名称、项目或社交账号链接",
                  "デフォルト値には他のユーザーのボット名・プロジェクト・SNS リンクは含まれません",
                )}
              </li>
            </ul>
            <button className="privacy-danger" onClick={erase}>
              {t(
                "이 브라우저의 저장된 초안 지우기",
                "Clear saved browser drafts",
                "清除这个浏览器保存的草稿",
                "このブラウザの保存済み下書きを消去",
              )}
            </button>
            <p>
              {t(
                "미디어나 SQLite 작업 기록을 지우려면 파일과 프로젝트를 확인한 뒤 별도로 관리하세요. 이 버튼은 그 데이터를 삭제하지 않습니다.",
                "Media and SQLite work records are not deleted by this button; manage them separately after reviewing the exact files and projects.",
                "要删除媒体文件或 SQLite 工作记录,请先确认具体文件和项目,再单独处理。这个按钮不会删除那些数据。",
                "メディアや SQLite の作業記録を削除するには、ファイルとプロジェクトを確認したうえで別途管理してください。このボタンではそのデータは削除されません。",
              )}
            </p>
          </article>
        </section>
        <p className="privacy-message" aria-live="polite">
          {message}
        </p>
      </main>
    </>
  );
}
