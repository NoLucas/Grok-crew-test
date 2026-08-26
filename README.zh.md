# Grok Crew

<p align="center"><a href="README.md">English</a> &nbsp;·&nbsp; <a href="README.ko.md">한국어</a> &nbsp;·&nbsp; <strong>简体中文</strong> &nbsp;·&nbsp; <a href="README.ja.md">日本語</a></p>

**Grok Crew 是装在你电脑上的短视频工作台。你只写规格。有两扇门：Grok，以及其他代理。**

不必把原片放在这台电脑。写好时长、字幕、要留下的句子，以及由哪扇门来做。**另一台电脑**上的机器人会做好视频和剪辑，只交到那扇门。这台电脑负责接收。只有你愿意时才发到 Instagram、TikTok 或 YouTube。

它不是托管素材的网站。机器人打不开这台电脑，只推送一个包裹。

```
你的规格  →  那扇门的发件箱  →  机器人取走 spec.json  →  那扇门的收件箱  →  这台电脑接收  →  你说可以才发布
```

## 给谁用

- 只想规定 Reel 长什么样、不想在这台机器上找原片的人
- 想让 Grok，或 Claude / Codex / ChatGPT 负责找素材和初剪，但门要分开、不能混用的人
- 仍希望成片落在这台电脑、而不是云端编辑器里的人

开始不需要账号。

## 你会看到什么

首屏有**两扇门**。在 Grok 门或其他代理门保存规格后，会进入那扇门的发件箱（`handoff-outbox/grok` 或 `handoff-outbox/agents`）。机器人读取那里的 `spec.json`——git 上则是 `outbox/grok/` / `outbox/agents/`——打不开这台电脑。完成后的 Grok 包裹放进 `handoff-inbox/grok`。Claude、Codex、ChatGPT 等放进 `handoff-inbox/agents`。每个**接收**按钮只导入自己的门，并从发件箱归档该规格。复制文字只是备用。**查看此门的示例送达**会用内置片段演示同一次到达。

然后是三个标签：

| 标签 | 用来做什么 |
| --- | --- |
| **编辑** | 看预览，在时间线上裁切 |
| **设置** | 风格、字幕、速度 |
| **导出** | 在本机保存 MP4，或在询问后再发布 |

预览是为了剪的时候画面跟得上的快速草稿。保存的文件用原片生成。

## 视频留在这台电脑

原片、剪辑和成片都在这台电脑上。没有 Grok Crew 云端项目，开始时也不用登录。

发布是可选的。默认是 **发布前确认**。如果可能已经发出过，再发一份之前会再问一次。Grok Crew 不会替你注册 Instagram、TikTok 或 YouTube。

## 可选：让这台电脑上的 AI 帮忙

如果 AI 已经在**同一台电脑**上运行，你可以用平常的话说：留下最有力的几句，加上字幕，剪成竖屏，文件放这里，不要上传。

另一台电脑上的 AI 打不开这张桌子。不会把素材寄出去让别处的机器人「看一眼」。

## 怎么打开

如果已经有人为你装好了，打开 Grok Crew 窗口即可，或在浏览器打开 [http://localhost:3000](http://localhost:3000/)。

如果要自己安装，需要 [Node.js 22+](https://nodejs.org/) 和 [Python 3.10+](https://www.python.org/downloads/)，然后：

```sh
git clone https://github.com/NoLucas/Grok-Crew.git grok-crew
cd grok-crew
npm run local
```

想用独立窗口而不是浏览器：先 `npm install` 一次，再 `npm run desktop`。第一次可能要几分钟。停止用 `Ctrl+C`。

你可以在这台电脑上制作并发布自己的视频。源码按 [BUSL-1.1](LICENSE) 公开，不是开源产品。提问：[CONTRIBUTING.md](CONTRIBUTING.md)。
