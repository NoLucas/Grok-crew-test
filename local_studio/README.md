# Local Video Studio

This companion service is a private, local production node for Local Video Workspace. It binds to `127.0.0.1` only and stores project and job metadata in `local_studio/data/studio.db`. Source and output media stay under `local_studio/workspace/`.

## What it does

- Stores projects, render jobs, approval records, and event history in local SQLite.
- Uses MoviePy locally to render EDLs into 1080×1920 H.264/AAC MP4 files.
- Generates optional low-resolution H.264 proxies under `workspace/proxies/` for lighter desktop preview; proxy jobs expose progress and retry state, while final renders always resolve each Timeline v2 asset's original `path`.
- Lets each local agent choose automatic local rendering or a human-approval gate for rendering.
- Desktop Export can publish a rendered MP4 to Instagram, TikTok, or YouTube Shorts when local env tokens are set. Official OAuth apps stay outside this repository. Instagram still uses Meta's resumable upload workflow.
- Runs renders and uploads on a background worker: starting a job returns immediately with a `queued`/`running` status, `GET /api/jobs/{id}` reports live `progress` (0–100), and `POST /api/jobs/{id}/cancel` requests cancellation before the next clip is processed. Pass `wait: true` in the request body (or `--wait` on the CLI) to block until the job finishes instead. A job still `running` when Local Studio stops unexpectedly is marked `failed` on the next startup.
- `GET /api/presets` lists quality, caption-layout, and platform presets (Reels/TikTok/Shorts 9:16, Feed square 1:1, Landscape/X 16:9); merge one into a project's `render_settings` instead of setting every field by hand.
- Captions can carry a background panel (`caption_bg` / `caption_bg_color`) and, per clip, an optional `word_timings` array for sequential word-by-word captions instead of one static line. A render fails fast with a clear error if no local font can be found, instead of silently skipping captions.
- `render_settings.music_track` mixes a workspace-relative audio file under the source audio (`music_volume`, `music_loop`). When the clip still has its own dialogue audio, the music bed automatically ducks under it (`music_ducking`, on by default; `music_duck_floor` sets how far it ducks, default 35%) instead of mixing in at one flat level.

## Configuration (local_studio/.env)

Copy `.env.example` to `local_studio/.env` to set any of these; all are optional and each falls back to a safe default when unset.

- `LOCAL_STUDIO_RENDER_WORKERS` — how many render jobs run at once (default `1`, i.e. a single background worker; jobs beyond that queue). Raise this only if the machine has CPU/RAM headroom for concurrent encodes.
- `LOCAL_STUDIO_ALLOWED_ORIGINS` — comma-separated browser origins allowed to call this API (default `http://localhost:3000,http://127.0.0.1:3000`). Change this only if the browser workspace is served from a different port or host.
- `LOCAL_STUDIO_FONT`, `LOCAL_STUDIO_WORKSPACE`, `LOCAL_STUDIO_TOKEN` — see their mentions elsewhere in this file.

## Start

1. From the repository's top-level folder, run `npm run local` or `npm run desktop`. Both prepare this service, the Python renderer, and the bundled sample clip. Later starts skip `pip` when requirements have not changed.
2. Copy `.env.example` to `.env` only if you want token protection or Instagram / TikTok / YouTube publishing.
3. For a Local Studio-only Windows session, run `./run.ps1` from this folder.
4. Or run `.venv\Scripts\python studio_server.py --port 7214` directly.
5. Social upload needs local credentials. Desktop Export is the everyday publish surface; the older Production console still has Instagram auto-upload, and the CLI can pass `--auto-upload`.

The default browser workspace is Desktop at `http://localhost:3000/`. The older Production console remains at `/production`. Create or queue jobs from either surface, or use `bot-contract.json` from a local agent with the same workstation access.

## Bot status and automation

Open `http://localhost:3000/bots` to see which local bots have actually checked in, their last action, and their recent activity. A bot is marked **active** only after it records a check-in within the last five minutes; a browser tab or an assumed bot is never counted as active.

Open `http://localhost:3000/bot-guide` for the bot-facing editing manual. A local bot starts by reading `GET /api/bot-entry`, then sends `POST /api/bot-entry` with its id, display name, purpose, and task. This creates an auditable local entry and the first heartbeat. A newly entered bot receives `auto_local` by default, which enables all local editing functions and its own local rendering; it may instead choose `approval_required`.

Read a bot's choice with `GET /api/bots/{bot_id}/execution-policy`, or record it with `POST /api/bots/execution-policy` using `mode=auto_local` or `mode=approval_required`. The Bot Check page shows the current choice beside each verified bot.

Local agents can record a check-in with `POST /api/bots/heartbeat`. Supply a `bot_id`, `display_name`, `action`, and optional `detail` object. If `LOCAL_STUDIO_TOKEN` is configured, the agent must receive that token through its own runtime configuration; it must not read `.env` or SQLite to obtain it. The browser’s Bot Check page includes a copy-ready request example.

If `LOCAL_STUDIO_TOKEN` is set, it is required on every reading request as well as every writing request — only `/health`, `/api/terminal-contract`, `/api/bot-guide`, `GET /api/bot-entry`, and the CLI download stay open without it. Local Studio also rejects any request whose browser `Origin` header is outside `http://localhost:3000` / `http://127.0.0.1:3000`, regardless of whether a token is configured, so a page open in another tab cannot drive this service.

## Operations center

Open `http://localhost:3000/operations` after creating a project in Production. It keeps the project’s transcript cut map, local media inspection, pre/post-render quality reports, bot task board, edit memory, audio plan, A/B variants, overlay slots, brand kits, publish preflight, failure notes, and performance notes in SQLite.

Bots can read `GET /api/projects/{id}/operations`. They can create a timestamped transcript cut map, request a local media inspection, record quality reports, and save planning artifacts. These records are non-destructive: they do not change the EDL, render a file, or start an Instagram upload by themselves.

## Terminal CLI for Grok bots

Any Grok bot runtime that runs in a terminal on this same PC can use the dependency-free CLI already included in a Git clone: `python local_studio/grok_crew.py contract` from the repository's top-level folder. `GET /downloads/grok-crew.py` remains available only for a bot that cannot access the cloned folder. The Terminal page at `http://localhost:3000/terminal` includes copy-ready commands.

`http://127.0.0.1:7214` is the CLI and JSON API service, not the browser workspace. For a page a bot needs to open or capture, run `python grok-crew.py site --page desktop` (or `production`, `operations`, `bots`, `guide`, `terminal`, or `privacy`) and use the printed `http://localhost:3000/...` URL. Opening a known browser page on port 7214 now redirects to the correct browser workspace.

The CLI covers bot entry and heartbeat, execution policy, projects, edit methods, P0–P2 operations, brand kits, and job queues. It refuses non-loopback URLs. If token protection is enabled, supply `LOCAL_STUDIO_TOKEN` only through that bot terminal's environment. A connected bot can use `policy set --bot-id <id> --mode auto_local` to queue and run its own local renders, or choose `approval_required` to require `--human-approved` for rendering. Use `jobs instagram --auto-upload` to start Instagram upload immediately, or leave it queued for direct execution.

## Cloud bot handoff (remote bots)

A bot that is **not** on this PC (a cloud sandbox, a different machine) cannot reach `127.0.0.1:7214` — that restriction is intentional and this project does not add a way around it. A collect or own-and-collect spec writes `spec.json` into both `workspace/handoff-outbox/agents/{id}` (collector) and `workspace/handoff-outbox/grok/{id}` (editor). An own-files spec writes the editor outbox only. Role names follow the bots that check in. The collector drops clips in `workspace/handoff-materials/{id}` with `origin` and `license` on each clip. Style recipes (`GET /api/v2/style-recipes` or `python local_studio/grok_crew.py spec recipes`) fill the spec. This desk does not scrape websites. `python local_studio/grok_crew.py handoff push-outbox` (or Desktop save, when `HANDOFF_REPO_REMOTE` is set) copies outbox folders to `outbox/agents/` and `outbox/grok/` on the handoff repo. Push is optional and never blocks the save. The assigned editor returns the cut through `handoff-inbox/grok` — never a network call to this PC:

1. Create a dedicated repository for this (this project uses [NoLucas/handoff-inbox](https://github.com/NoLucas/handoff-inbox)) and give the remote bot credentials that can push only to it (a fine-grained PAT scoped to just that repository is recommended).
2. Set `HANDOFF_REPO_REMOTE` and `HANDOFF_BRANCH` in `local_studio/.env` (see `.env.example`) so outbox push and `handoff_watcher.py` know where to look; otherwise pass `--repo-remote`/`--branch` on the command line.
3. The remote bot reads `outbox/grok/{edit_spec_id}/spec.json` or `outbox/agents/{edit_spec_id}/spec.json`, then pushes one inbound folder under `grok/` or `agents/` containing `bundle.json` (the same `local-video-workspace.project-bundle/v1` schema `bundle export`/`bundle import` already use) plus the referenced media file. Set `bundle.project.door` to match that folder and `created_by` to the assigned bot name. Never put media under `outbox/`. See `local_studio/handoff-guide.json` (or `handoff-guide.ko.json`, `handoff-guide.zh.json`, `handoff-guide.ja.json`) for the exact contract to hand that bot. An editor-door pull never imports `agents/`.
4. On this PC, Desktop **Receive** or `python local_studio/grok_crew.py handoff pull --door grok` imports one door and archives that spec from the outbox. `python local_studio/handoff_watcher.py` (add `--once` to run a single pass, or register it in Windows Task Scheduler to run continuously at logon) polls inbound `grok/` and `agents/` only — it skips `outbox/` — copies media into `local_studio/workspace/`, and calls this service's own `/api/projects/import` — no new server code, no open port.
5. A render job created this way runs automatically once its bundle marks it `approved: true`, since rendering only produces a local file. An Instagram publish job stays **queued for a person to run from Production** unless the operator explicitly starts the watcher with `--allow-auto-upload` *and* the bundle itself requests `handoff_auto_upload_requested: true` — both are required, and the flag is off by default.

## Instagram guardrails

The service never stores Meta tokens in SQLite and only reads them from local process environment variables. It calls Instagram only when an Instagram job is explicitly run or a job is created with auto-upload enabled. The publication client follows the resumable container → binary upload → status poll → publish sequence documented in Meta's sample.
