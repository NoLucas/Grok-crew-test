# Grok Crew

<p align="center"><strong>English</strong> &nbsp;·&nbsp; <a href="README.ko.md">한국어</a> &nbsp;·&nbsp; <a href="README.zh.md">简体中文</a> &nbsp;·&nbsp; <a href="README.ja.md">日本語</a></p>

**Turn rough short-form footage into a bot-ready edit plan, a local MP4, and an optional Instagram, TikTok, or YouTube upload—without sending the project, media, or bot history to a cloud backend.**

<p>
  <img alt="Local-first" src="https://img.shields.io/badge/local--first-127.0.0.1-1d1d1b?style=flat-square">
  <img alt="Node 22 or newer" src="https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square">
  <img alt="Python 3.10 or newer" src="https://img.shields.io/badge/Python-3.10%2B-3776AB?style=flat-square">
  <img alt="Runs on your computer" src="https://img.shields.io/badge/runs-on%20your%20computer-f4c400?style=flat-square">
</p>

## Desktop control workspace

The default workspace is the Desktop at [`/`](http://localhost:3000/). It is the same surface in the browser (`npm run local`) and in Electron (`npm run desktop`): project/version navigation, a program monitor, a multitrack timeline, local analysis/rendering, publish receipts, rollback, and signed encrypted Runner handoffs. The first screen stays on local editing; Runner and GitHub stay collapsed until you pair them. Legacy pages such as `/production` still run, but they are planning or older consoles—open Desktop for everyday editing.

```sh
npm install
npm run desktop
```

Build the PyInstaller sidecar and Windows/macOS package with `npm run desktop:pack` or `npm run desktop:dist`. See the [Korean desktop guide](docs/DESKTOP.ko.md) and [Runner guide](runner/README.md) for the implemented preview workflow and explicit current limits. Existing `/api/*`, CLI, and legacy pages remain compatible.

<h2 align="center">Watch it work</h2>

<p align="center">
<a href="public/demo/quickstart-chat-demo.mp4"><img src="public/demo/quickstart-chat-demo.gif" alt="Watch a real local bot clone, run, and edit with Grok Crew" width="380"></a>
</p>

<p align="center"><em>A real local bot clones the repo, starts it, and turns a plain-language request into a captioned vertical cut. Click it to open the full MP4.</em></p>

## Run it locally

```sh
git clone https://github.com/NoLucas/Grok-Crew.git grok-crew
cd grok-crew
npm run local
```

Open the [Desktop](http://localhost:3000/) when the setup finishes. The first run installs local dependencies once, then skips that work on later starts. If the project list is empty, click **Start with the sample** — no second terminal, cloud account, or API key. The older [Production](http://localhost:3000/production) console remains available.

> **License:** Grok Crew is source-available under [BUSL-1.1](LICENSE), not an open-source project. See the [license](LICENSE) for the exact use rights.

### Render a real sample immediately

On Desktop, click **Start with the sample** to open the bundled two-cut project. Optional: keep `npm run local` running and run `npm run sample` in a second terminal to also render `local_studio/workspace/outputs/grok-crew-sample-render.mp4`. That command does **not** create an Instagram job. See [sample-project](sample-project/README.md).

## Tell a Grok bot what to do

Hand any local agent on the **same PC** these three lines:

```text
1. git clone https://github.com/NoLucas/Grok-Crew.git grok-crew
2. cd grok-crew
3. npm run local
```

Then ask it to actually edit something — see the demo at the top of this page for what that looks like end to end.

Nothing was uploaded — the bot only used the local API. Name the source, format, editing goal, delivery path, and upload preference and the bot reads the local Bot Guide and turns it into the right local calls itself. A bot on another computer or in a cloud sandbox cannot open this PC's loopback workspace directly; use the [cloud bot handoff](#cloud-bot-handoff-for-a-bot-that-isnt-on-this-pc) for that case.

## Why Grok Crew?

Short-form editing breaks down when the creative brief, bot instructions, cut decisions, render jobs, and delivery status live in different tools. Grok Crew makes that handoff visible and repeatable on one computer:

```text
rough footage → transcript cut map → bot edit method → local MP4 → queue or auto-upload
```

It is a **local production desk for people and same-PC bots**, not a cloud video editor and not a remote bot service.

## First-run details

### What you need

- Node.js 22 or newer
- Python 3.10 or newer
- A local clone of this repository

`npm run local` (browser) and `npm run desktop` (Electron) both prepare the Python renderer and the bundled sample. Later starts skip `pip` when requirements have not changed. Stop with `Ctrl+C`; running the same command later resumes the local workspace.

`npm run launch:verify` prints the P3 local 1.0 gates (publish receipts, loopback sidecar) and marks OAuth apps, code signing, and in-place auto-update as external.

### Give a local bot its first task

Run these commands from the cloned folder in the bot's terminal:

```sh
python local_studio/grok_crew.py contract
python local_studio/grok_crew.py entry --bot-id editor-01 --display-name "Editor 01" --purpose edit_video --task "Prepare a transcript-first short-form edit plan." --execution-mode auto_local
```

Then open [Bot Check](http://localhost:3000/bots). The bot appears only after it has actually checked in.

## The first useful workflow

1. Open **Desktop** at `/` and create a project using media under `local_studio/workspace/inputs`.
2. Let the bot read the [Bot Guide](http://localhost:3000/bot-guide), set its edit method, and save a transcript cut map.
3. Use **Operations Center** to inspect media, save project memory, compare A/B edits, and run quality checks.
4. Render locally from Desktop (or the older Production console). A bot can use `auto_local`, or choose a human-approval gate for its own renders.
5. Publish from Desktop Export to Instagram, TikTok, or YouTube when local tokens are configured. Failed or interrupted receipts can be retried; an interrupted retry asks before sending a possible second copy.

## What it does

| Instead of | Grok Crew gives you |
| --- | --- |
| A bot that edits from a vague prompt | A structured local guide, edit method, project memory, and visible task board |
| Guessing where silences, retakes, and filler are | Transcript-first cut maps and media preflight reports |
| Discovering problems after export | Pre-render, post-render, and delivery quality reports |
| Losing editing context between bot runs | Local SQLite project memory, job history, and bot heartbeat records |
| A publish action with unclear status | A local MP4 render queue and optional Instagram, TikTok, or YouTube publish with receipts |

### Built-in production tools

- Program monitor draft preview (capped JPEG composite, optional proxy) while final render stays on original media
- Project setup, local source/output paths, and render settings
- Transcript cut maps for word- and phrase-led editing
- Reframing, captions, speed, FPS, look, audio policy, and quality choices
- Media inspection for orientation, FPS, duration, audio, black frames, and silence
- Quality checks before render, after render, and before delivery
- Project memory, bot task board, audio plan, A/B variants, brand kits, and overlay slots
- Failure notes and performance notes for the next edit
- Bot Check with real entry, heartbeat, edit, render, and upload progress
- Korean, English, Chinese, and Japanese interfaces plus a machine-readable bot guide

## What works now vs. planning and preview

| Actually runs on this computer | Planning, preview, or non-destructive work |
| --- | --- |
| **Desktop (`/`)** is the default workspace: timeline edits, local renders, and Instagram / TikTok / YouTube publish (env tokens). The older **Production** console can still create a project and render a local MP4. | **Edit Lab, Cut Log, Agent Desk, Connect, Packet, Gates, Export, and Library** help draft, preview, package, or move a plan. They do not cut source media, start a render, or upload anything. |
| **Bot Check** records real bot entries, heartbeats, policies, and job activity in local SQLite. The same-PC terminal CLI creates projects and runs jobs through the same local service. | **Operations Center** can save cut maps, memory, task assignments, A/B variants, audio/overlay plans, brand kits, and quality reports; these are local and useful, but non-destructive until a project is rendered in Production. |
| **Operations Center** also performs local media inspection and pre-/post-render quality checks. | **Bot Guide, Terminal, and Privacy** are local instructions and status views; they do not themselves change media. |

## Pages at a glance

The browser workspace at `localhost:3000` is split into these local pages. The live-action boundary above is deliberate: planning never silently changes a source file or publishes a post.

- **`/` Desktop — the default workspace. Timeline, local render, publish receipts, and Instagram / TikTok / YouTube export.**
- `/edit` Edit Lab — frame, motion, typography, timing, and caption preview (planning only, does not affect the real render)
- `/cut` Cut Log — mark kept/dropped segments from the transcript (does not cut the actual file)
- `/production` Production — older create/render/Instagram console. Prefer Desktop for everyday work.
- `/operations` Operations Center — media inspection, quality reports, project memory, the task board, A/B variants, audio/overlay plans, and brand kits
- **`/bots` Bot Check — bot entry, heartbeat, and execution policy (`auto_local` vs. approval required). This is the only page where real bot activity is recorded.**
- `/terminal` Terminal — CLI/API instructions for a bot on this same PC
- `/bot-guide` Bot Guide — the machine-readable editing rules, workflow, and boundaries for bots
- `/library` Library — local reference material
- `/agent` Agent Desk — brief, rules, task list, and handoff notes
- `/connect` Connect — export/import an offline snapshot for a manual handoff (no server call)
- `/packet` Packet — a single-piece brief and caption packet
- `/gates` Gates — a pre-publish readiness checkpoint
- `/export` Export — resolution, caption packet, and final delivery details
- `/privacy` Privacy — the "only on this PC" boundary and a local-data reset

### A real example

A bot drove this end to end with the CLI only, no browser clicks: it created a project in Production (`inputs/source.mp4` → `outputs/final-video.mp4`), set the Finish Rack to 9:16, 30fps, compact quality, center reframe, captions on, and muted audio, entered through Bot Check with an `auto_local` execution policy, then rendered two joined clips — 0–4s ("ONE ASK") and 5–9s ("SIX LINES") — into an 8-second local MP4. Cut Log, the edit method, Operations, and the actual Instagram upload are the parts a person still clicks through directly in the browser.

## For bots: browser or terminal

Every clone includes a dependency-free local CLI. It only accepts loopback addresses.

```sh
# Read the complete machine-readable manual
python local_studio/grok_crew.py guide

# Print a browser page for any workspace tool
python local_studio/grok_crew.py site --page operations
python local_studio/grok_crew.py site --page export

# Check actual bot presence and work history
python local_studio/grok_crew.py bots list
python local_studio/grok_crew.py bots activity
```

Available pages include `desktop`, `studio`, `edit`, `cut`, `production`, `operations`, `bots`, `guide`, `terminal`, `library`, `agent`, `connect`, `packet`, `gates`, `export`, and `privacy`.

See [the local bot manual](local_studio/README.md) for the full command set, or open [Bot Guide](http://localhost:3000/bot-guide?lang=en) after starting the workspace.

## Privacy and optional social delivery

The browser workspace runs at `localhost:3000`; Local Studio binds to `127.0.0.1:7214`. Source media, renders, SQLite records, and bot histories remain under `local_studio/` on the current computer.

Instagram, TikTok, and YouTube delivery is optional. Each needs the owner’s locally configured access token and a supported local MP4. Official OAuth apps stay outside this repository. Credentials are never stored in SQLite or exposed to a bot through this project.

## Cloud bot handoff (for a bot that isn't on this PC)

Local Studio still never accepts a connection from another machine — that does not change for a bot running in a cloud sandbox or a different computer. Instead, such a bot hands off a finished edit through a dedicated git repository, and `local_studio/handoff_watcher.py` (running on the owner's own PC) polls that repository and applies the handoff through the same local API a same-PC bot already uses. See [the local bot manual](local_studio/README.md) for setup, and `local_studio/handoff-guide.json` (or `handoff-guide.ko.json`, `handoff-guide.zh.json`, `handoff-guide.ja.json`) for the exact package format to hand that bot.

## Use cases

- A creator turns a talking-head recording into a tight vertical Reel without losing the edit reasoning.
- A small content team lets multiple local bots split research, cut planning, QA, and packaging while seeing ownership and status.
- A developer tests a video-editing agent locally before deciding whether any workflow should leave the device.
- A cloud-hosted bot without loopback access to the owner's PC produces the media and edit plan, then hands it off through a dedicated git repository instead of any direct connection.

## Roadmap

- [x] Publish delivery for Instagram, TikTok, and YouTube Shorts (local env tokens; OAuth apps stay external)
- [ ] Community-maintained example edit packs

## Feedback and contributions

Found a rough edge or have an editing workflow worth preserving? Please start with [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports, feature requests, small focused pull requests, and reproducible local job failures are especially useful.

This repository is source-available under the [Business Source License 1.1](LICENSE) (`BUSL-1.1`), not a permissive open-source license. You may use, copy, and modify it for personal, educational, or internal business purposes, including running it locally to produce and publish your own content — see the license's Additional Use Grant for the exact terms. Offering it, or a derivative of it, to third parties as a hosted or competing commercial product requires a separate license from the copyright holder. It converts to the MIT License on 2030-08-23.
