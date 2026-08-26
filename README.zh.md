# Grok Crew

<p align="center"><a href="README.md">English</a> &nbsp;·&nbsp; <a href="README.ko.md">한국어</a> &nbsp;·&nbsp; <strong>简体中文</strong> &nbsp;·&nbsp; <a href="README.ja.md">日本語</a></p>

**Grok Crew 是装在你自己电脑上的短视频剪辑台。**

把口播或手机拍的素材拿进来，在时间线上裁切，成片保存在这台电脑。只有你愿意时才发到 Instagram、TikTok 或 YouTube。你不让它上传，视频就不会离开这台机器。

它不是替你托管素材的网站，也不是社交应用。它是「拍完了」和「变成一条 Reel」之间的那张桌子。

```
我的素材  →  在这台电脑上剪  →  成片文件  →  我说可以才发布
```

## 给谁用

- 想做竖屏短视频、又不想把原片传到别人云盘的创作者
- 希望剪辑、成片、「发出去了没有」都在一处看见的小团队
- 以后可能让**同一台电脑**上的 AI 起草剪辑、但仍要自己看过再确认的人

开始不需要账号。

## 你会看到什么

首屏是 **在这台电脑开始第一个视频**。

- **从示例开始** — 打开一段现成的短示例
- **用我的素材开始** — 从这台电脑导入视频

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
