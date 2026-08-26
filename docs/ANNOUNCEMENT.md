# Announcement draft

Operator-owned. This repo does not post to social networks, Discord, or Hacker News.
Copy what you need. Do not invent a launch date or user count.

## The problem

Short-form editing with an AI bot usually loses context. A cut map lives in one chat, the export job in another, and the Instagram/TikTok/YouTube step in a third. When a render fails or a caption changes, there is no single local record of what was approved.

## The first win

On one PC: write a title → **Copy this for the bot** → paste the invite into one agent (Cursor, or any other) → that agent drops the cut in `handoff-inbox/editor` → the window opens. Or drop your own file and skip the bot. The same MoviePy timeline drives the program monitor and the final MP4. Draft preview can use proxies; the final render always uses the original.

```
title / invite → one bot → editor inbox → timeline → local MP4 → optional upload
```

## The local-first boundary

Grok Crew binds Local Studio to `127.0.0.1`. Remote website origins cannot call the API. Instagram, TikTok, and YouTube publish today with **your** access tokens. Official OAuth apps, Apple code signing, notarization, and unsigned in-place auto-update stay **outside this repository** — this project does not register those apps or ship certificates.

GitHub token login works without an OAuth app. Device flow needs an operator-owned GitHub OAuth app.

## One feedback ask

Please try the local cut → render path on a 15–60s talking-head clip and tell us which of these broke first:

1. Caption timing on the program monitor vs the rendered MP4
2. Cut-map / timeline revision when you undo or restore
3. Local render reliability (queue, cancel, Compact/Balanced/High)

Open an issue on [NoLucas/Grok-crew-test](https://github.com/NoLucas/Grok-crew-test) with OS, a short screen recording, and whether you used Desktop (`npm run desktop`) or the browser workspace (`npm run local`).

## Short posts

**English**

> Grok Crew 1.0 is a local-first short-form desk: write a title, copy one invite to a bot (Cursor or any other), and the cut opens when the editor inbox gets a folder. Or drop your own file. Optional token publish. OAuth apps and Apple signing stay operator-owned. Try a 15–60s talking-head render and tell us if captions, revisions, or local render broke first. https://github.com/NoLucas/Grok-crew-test

**한국어**

> Grok Crew 1.0은 로컬 우선 숏폼 책상입니다. 제목을 적고 초대문을 봇(Cursor 또는 다른 에이전트)에 붙이면, 편집 인박스에 폴더가 올 때 창이 열립니다. 내 파일을 놓으면 봇 없이 열립니다. 게시는 선택입니다. OAuth 앱과 Apple 서명은 저장소 밖입니다. 15–60초 토킹헤드를 렌더해 보시고, 자막·리비전·로컬 렌더 중 무엇이 먼저 깨지는지 알려 주세요. https://github.com/NoLucas/Grok-crew-test
