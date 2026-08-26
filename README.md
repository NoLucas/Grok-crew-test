# Grok Crew

<p align="center"><strong>English</strong> &nbsp;·&nbsp; <a href="README.ko.md">한국어</a> &nbsp;·&nbsp; <a href="README.zh.md">简体中文</a> &nbsp;·&nbsp; <a href="README.ja.md">日本語</a></p>

**Grok Crew is a short-form desk on your computer. You write the brief. There are two doors: the editor door, and the collector / other-agent door.**

You do not have to drop a source file here. You say how it should feel — length, captions, what to keep — and which door should do the work. A bot on **another computer** makes the video and the edit, then hands the folder to that door only. This PC receives it and shows the timeline. You post to Instagram, TikTok, or YouTube only if you choose to.

It is not a website that holds your footage. The bot never opens this PC. It only pushes a package.

```
your brief  →  collector outbox + editor outbox  →  collector drops clips in the materials box  →  the assigned editor cuts those clips  →  editor inbox  →  this PC receives it  →  post only if you say so
```

## Who it is for

- People who want to specify the Reel, not hunt for the raw file on this machine
- Creators who let the connected bots do the sourcing and the first cut — on separate doors, never mixed
- Anyone who still wants the finished file to land on this PC, not in a cloud editor

You do not need an account to start.

## What you see

The first screen lets you pick a **style recipe** (Instagram Reel, TikTok tight cut, YouTube Short, or YouTube long) and where the pictures come from (your files, a collector, or both). Role names follow the bots that check in. A collect spec still uses two bots: the collector reads `handoff-outbox/agents` and drops clips in `handoff-materials` with a license on each file. An own-files spec goes to the editor outbox only. The assigned editor cuts those clips and returns the package to `handoff-inbox/grok`. This desk does not scrape websites. Copying the briefs is a backup. **See a collector sample** and **See an editor sample** show the same arrival using a bundled clip.

Then you work in three tabs:

| Tab | What it is for |
| --- | --- |
| **Edit** | Watch the preview, cut on the timeline |
| **Setup** | Look, captions, speed |
| **Export** | Save an MP4 here, or post after it asks |

The preview is a fast draft. The file you save is made from the footage the bot sent. Opening a file already on this computer is optional and tucked under the brief.

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
