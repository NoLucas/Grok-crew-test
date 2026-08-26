# Grok Crew

<p align="center"><strong>English</strong> &nbsp;·&nbsp; <a href="README.ko.md">한국어</a> &nbsp;·&nbsp; <a href="README.zh.md">简体中文</a> &nbsp;·&nbsp; <a href="README.ja.md">日本語</a></p>

**Grok Crew is a short-form video editor that stays on your computer.**

You bring in a talking-head clip or a phone recording. You cut it on a timeline. You get a finished file on this PC. You post to Instagram, TikTok, or YouTube only if you choose to. If you never ask it to upload, the video never leaves.

It is not a website that holds your footage. It is not a social app. It is the desk between “I filmed this” and “this is the Reel.”

```
my clip  →  edit on this PC  →  finished file  →  post only if I say so
```

## Who it is for

- Creators who want a tight vertical cut without sending the raw file to someone else’s cloud
- Small teams who want the cut, the file, and the “did it post?” status in one place
- Anyone who may later ask an AI helper on the **same computer** to draft the edit — and still wants to see and approve what changed

You do not need an account to start.

## What you see

The first screen is **Start the first video on this PC**.

- **Start with the sample** — try a short ready-made project
- **Start with my footage** — import a video from this computer

Then you work in three tabs:

| Tab | What it is for |
| --- | --- |
| **Edit** | Watch the preview, cut on the timeline |
| **Setup** | Look, captions, speed |
| **Export** | Save an MP4 here, or post after it asks |

The preview is a fast draft so the picture keeps up while you edit. The file you save is made from the original footage.

## Your video stays on this computer

Raw clips, the edit, and the finished file live on this PC. There is no Grok Crew cloud project and no login wall.

Posting is optional. The default is **Ask before posting**. If a post may have already gone out, it asks again before sending a second copy. Grok Crew does not create your Instagram, TikTok, or YouTube account.

## Optional: ask AI on this PC

If an AI helper is already running on **this same computer**, you can say in plain language: keep the strongest lines, add captions, make a vertical cut, save the file here, do not upload.

A helper on another computer cannot open this desk. Your footage is not sent out so a bot elsewhere can “just take a look.”

## How to open it

If someone already set Grok Crew up for you, open the Grok Crew window — or a browser at [http://localhost:3000](http://localhost:3000/).

If you are setting it up yourself, you need [Node.js 22+](https://nodejs.org/) and [Python 3.10+](https://www.python.org/downloads/), then:

```sh
git clone https://github.com/NoLucas/Grok-Crew.git grok-crew
cd grok-crew
npm run local
```

A desktop window instead of the browser: `npm install` once, then `npm run desktop`. The first start can take a few minutes. Stop with `Ctrl+C`.

You may use it on this computer to make and publish your own videos. The source is shared under [BUSL-1.1](LICENSE); it is not an open-source product. Questions: [CONTRIBUTING.md](CONTRIBUTING.md).
