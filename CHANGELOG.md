# Changelog

All notable changes to Grok Crew are documented here.

## Unreleased

### Security

- Publish HTTP clients now refuse redirects and connect only to the IP checked during URL validation, so a 307 or DNS rebind cannot send the video to an internal address.
- CGNAT (`100.64.0.0/10`) and IPv4-mapped loopback addresses are treated as blocked upload targets.
- An empty `Origin` header is no longer treated as a missing Origin. Curl/Electron with no Origin stay allowed; `Origin: ` and `Origin: null` stay blocked.
- Publish receipts claim `running` atomically, so overlapping retries cannot double-post. Crash recovery marks leftovers `interrupted` and retry reports `possible_duplicate`.
- Publish error redaction also covers JSON secret fields such as `"access_token": "..."`.
- Workspace-relative paths always use `/`, including on Windows.
- Desktop only shows and retries receipts whose `project_id` matches the open project.
- GitHub release URL matching is case-insensitive for the `owner/repo` slug.
- Instagram, YouTube, and TikTok upload URLs are now https-only, host-allowlisted, and rejected when they resolve to a private or loopback address.
- Publish error text also redacts OAuth headers, refresh tokens, `ya29.` / `ghp_` / `github_pat_` / `sk-` secrets.
- Publish retry keeps only caption/privacy/render fields; client `approved` / `receipt_id` / extra keys are not forwarded into the publisher.
- GitHub update checks require an `owner/repo` slug; `openExternal` only opens that repo's `https://github.com/.../releases` pages, and new windows are limited to github.com.
- `INSTAGRAM_API_VERSION` / `INSTAGRAM_USER_ID` and Instagram container ids are constrained before they enter URL paths.
- Publish results store a workspace-relative `source_path` (filename only if the file is outside the workspace).
- Local Studio token compare is length-safe, so a short Authorization header returns 401 instead of leaking a digest-length error.
- GitHub device-flow verification URLs must be `https://github.com/login/device...` before the desktop opens them.
- Timeline assets, LUT files, and OTIO imports now reject paths outside the local workspace, so render/preview cannot read arbitrary files.
- Electron IPC normalizes Studio URLs before fetch, so `/api/../media` no longer bypasses the `/api` allowlist.
- Renderer navigation now compares origins instead of string prefixes, blocking `http://127.0.0.1:port@evil` style loads.
- IPC handlers require the main window as sender; preload fails closed without a runtime argument.
- `/health` hides workspace and database paths unless a configured token is presented.
- Unexpected handler exceptions return a generic 500 instead of internal strings; malformed `Range` headers return 416.
- Render-queue jobs now require the same human approval or `auto_local` gate as `/render`.
- The desktop UI no longer reads a Local Studio token from `localStorage`. Browser responses send a Content-Security-Policy.

### Added

- Door-scoped outbox. Saving a spec writes `spec.json` and `brief.txt` to `handoff-outbox/grok/{id}` or `handoff-outbox/agents/{id}`. Optional git push uses `outbox/grok/` or `outbox/agents/` and never fails the save if `HANDOFF_REPO_REMOTE` is unset. Receiving a cut archives that spec to `.processed/`. Bots still must not call `127.0.0.1`.
- Two handoff doors. The operator writes a spec on the Grok door or the other-agent door. Grok packages land in `handoff-inbox/grok`; Claude, Codex, ChatGPT, and other agents land in `handoff-inbox/agents`. A Grok pull never imports the other door. Runner pairing stays Grok-only. Desktop shows the spec desk only when no project is open.
- Incoming packages store `handoff_door` plus a sender name from `bundle.project.created_by` (Grok, Claude, Codex, ChatGPT, Gemini, Cursor, or the written name). The project list and project bar show who delivered the cut.
- Desktop first screen stays local-first: Runner/GitHub controls stay collapsed until pairing, a live job, or the operator opens them. Opening a project lands on Edit (program monitor + timeline) instead of Setup.
- Unclaimed `queued` Grok jobs no longer force the Runner/GitHub inspector open. The collapsed desk shows a cancel control, and `POST /api/v2/control-jobs/cancel-unclaimed` (or cancel on a job with no `runner_id`) marks those jobs `cancelled` immediately so a leftover click cannot hold the first screen.
- Draft-proxy status for every Timeline v2 video sits under the program monitor (and still in the inspector), so the list stays visible when the Status drawer hides the right column under 1050px. Monitor actions show `ready/total`. Final render still uses originals.
- Program-monitor HTTP preview keeps an LRU of MoviePy composites (default 4 slots, `LOCAL_STUDIO_PREVIEW_CACHE_SLOTS`). Switching projects or revisions reuses a live clip instead of rebuilding. A newly ready B-roll proxy still changes the fingerprint. `write_videofile` and `preview_at()` without `project_id` stay one-shot so parity goldens stay 1:1 with the final MP4.
- `docs/ANNOUNCEMENT.md` holds the launch post draft (problem, first win, local-first boundary, one feedback ask). Posting it stays operator-owned. `npm audit` is clean on `vinext@1.0.0-beta.8`.
- Opening a Desktop project queues draft proxies for every Timeline v2 video (`POST .../proxies` with `ensure_all` or `asset_id: "*"`). The monitor toggle stays primary-focused; draft preview picks up ready B-roll proxies. Final render still uses originals only.
- Program monitor HTTP preview now defaults to a draft composite: max 540px wide, JPEG, cheaper audio RMS, and ready proxies when they exist. `GET .../preview?quality=full` and Python `preview_at()` stay 1:1 with the final MoviePy render.
- `GET /api/v2/launch` and `npm run launch:verify` now inventory operator-owned OAuth app and macOS signing env **names** (presence only, never values). `oauth_apps.ready` and `code_signing.ready` stay `false` even when those names are set — this repo still does not register apps or flip `electron-builder` notarize.
- First-run no longer needs a second terminal: Desktop can open the bundled sample project in one click (`POST /api/v2/first-run/sample`). `npm run local` and `npm run desktop` share the same Python + sample bootstrap, and later starts skip `pip` when `requirements.txt` is unchanged.

- P3 publish receipts: list recent Instagram/TikTok/YouTube attempts, retry a failed receipt with the same idempotency key, and mark receipts left `running` as failed on the next Local Studio start.
- Publish failures redact bearer/access tokens before they are stored or returned.
- `GET /api/v2/launch` reports local 1.0 gates versus external OAuth, code signing, and in-place auto-update.
- Packaged desktop can check GitHub releases and open the download URL. Unpackaged builds stay on the local tree; unsigned in-place install remains external.
- Desktop Export shows receipt status/retry, and the title bar reports local launch gates plus the current update policy.
- `npm run launch:verify` prints the local/external launch report.
- UI-01..UI-10 desktop quality: readable type scale, 8px spacing, first-project/version/receipt empty states, workspace loading and reconnect, focus-visible rings, narrow titlebar tabs, project/status drawers, and a visible command-bar message on small screens.
- Loopback preview ports such as `127.0.0.1:43123` can call Local Studio. Remote website origins stay blocked.

- P1-08 program-monitor composite preview now samples the same MoviePy timeline used for final output, so playhead frames, captions, timing, and audio RMS can be compared 1:1 with the rendered MP4.
- P2-01 compositing: per-clip blend modes, rectangle/ellipse masks with feather, and chroma key.
- P2-02 motion: speed-ramp easing, attach-to-tracker points, and a lightweight stabilize pass.
- P2-03 nested sequence assets and multicam camera switching.
- P2-04 lift/gamma/gain/saturation grade, `.cube` LUT, and waveform/parade scopes on the program monitor.
- P2-05 track EQ and compressor in the audio mixer.
- P2-06 CMX EDL / OTIO-shaped exchange and a desktop render queue.

- P1-02 track editing in the desktop timeline: persistent clip groups, track lock/mute/solo controls, marker add/remove, frame-based snapping, range and additive multi-selection, and atomic movement of a selected group.
- P1-03 persistent undo/redo history: every action creates a new immutable revision, redo survives restart, a divergent edit clears the redo branch, and the desktop exposes buttons plus standard keyboard shortcuts.
- P1-04 local proxy editing: generate and retry a lightweight H.264 proxy, monitor progress, switch preview between proxy and original, and keep final MoviePy renders pinned to the original asset.
- P1-05 clip keyframes for position, scale, rotation, crop, opacity, volume, and speed, with linear/hold interpolation, immutable timeline updates, precision-panel controls, and MoviePy render evaluation.
- P1-06 edit elements: add B-roll video, editable caption clips, and rendered title overlays from the desktop inspector, plus per-clip fade, crossfade, and dip-to-black transition controls.
- P1-07 audio mixer with clip keyframe volume, persistent track volume/role, mute/solo-aware output, and optional music ducking under dialogue with a configurable floor.
- P1-08 render contract and golden output coverage for frame order, duration/frame count, captions, audio, active tracks, and original-asset final rendering.
- P1-09 terminal-free Playwright Electron E2E covering project creation, direct editing, markers, undo/redo, proxy preview, and local render; CI runs the flow under Xvfb.
- Focused backend and UI tests for P1-02 persistence, locked-item protection, selection behavior, marker validation, snapping geometry, and multi-clip movement.

### Changed

- Balanced local encodes use ffmpeg `faster` and High uses `medium`, so export iteration is quicker. Compact stays `veryfast`. Final output still reads original assets, never proxies.
- README, Local Studio, and the desktop guide treat Desktop (`/`) as the default workspace. Instagram, TikTok, and YouTube publish are documented as implemented with local env tokens; official OAuth apps stay external.
- Desktop Export asks before retrying an interrupted publish receipt, because the platform may already have the first upload. Receipt retry buttons stay visible when the error text is long.
- Legacy browser pages keep their routes and show a banner that points to Desktop. Production and Bot Check can still run live jobs; the other header pages stay planning or preview. Production no longer crashes when a Desktop Timeline v2 project has no legacy `clips` array.
- `npm run local` and `site --page desktop` open `/` instead of sending operators to `/production`.
- First-run docs tell operators to click Start with the sample instead of opening a second terminal for `npm run sample`.

- Core verification now runs every focused timeline UI test, so P1-01 and P1-02 interaction regressions are included in CI.

## 0.2.3 — 2026-08-25

### Added

- Closing the desktop window now keeps Grok Crew running in the Windows notification area/menu bar. The tray menu provides `Grok Crew 열기`, `숨기기`, and `종료`, and clicking the tray icon restores the workspace.
- The desktop app now enforces a single running instance; launching it again while hidden restores the existing window instead of starting a second sidecar and tray icon.

## 0.2.2 — 2026-08-25

### Fixed

- Local transcript and scene analysis results are now shown inside the source card with scene thumbnails, timecodes, media facts, and an explicit transcript status instead of being reduced to a footer message.
- Local analysis has its own progress state, so completing an analysis reliably restores its button and no longer leaves the global `Start with Grok` action looking busy.
- Analysis thumbnails are served through a project-scoped, path-validated loopback endpoint so the sandboxed desktop renderer can preview them without exposing arbitrary local files.

## 0.2.1 — 2026-08-25

### Added

- Automatic music ducking under dialogue (`music_ducking`, on by default, and `music_duck_floor`): a background music bed now quiets automatically while a clip's own dialogue audio is present instead of mixing in at one flat level.
- `LOCAL_STUDIO_RENDER_WORKERS` (render concurrency) and `LOCAL_STUDIO_ALLOWED_ORIGINS` (the CORS/Origin allow-list, previously hardcoded to port 3000) are now documented `.env` settings; both default to the previous behavior when unset.
- The live browser workspace and bot guide now support Chinese and Japanese, matching the existing README translations. The language switcher (`app/language.tsx`) now offers `zh`/`ja` alongside `ko`/`en`, every page's UI text has zh/ja translations, and `local_studio/bot-guide.zh.json` / `bot-guide.ja.json` are served from `GET /api/bot-guide?lang=zh|ja`.
- `local_studio/handoff-guide.zh.json` and `handoff-guide.ja.json` bring the offline cloud-bot handoff contract up to the same four languages as the rest of this release; every place that references the guide (`bot-contract.json`, all four `README.*.md`, `local_studio/README.md`) now points to all four language files.
- Unit tests for the handoff watcher's per-cycle package limit (`folders_for_cycle`), completing test coverage of all three handoff safeguards (media size cap, bundle size cap, and packages-per-cycle).

### Changed

- All four `README.*.md` files now say "Korean, English, Chinese, and Japanese interfaces" instead of the stale "Korean and English" left over from before the zh/ja UI expansion.
- Removed the "Maintainer launch checklist" section from all four `README.*.md` files — it told readers to "publish a tagged first release" before announcing, but `v0.1.0` and `v0.2.0` were already tagged and released; `docs/LAUNCH.md` remains as the internal checklist.
- Trimmed the Roadmap in all four `README.*.md` files down to the two still-open items; the fourteen already-shipped items are already recorded in this changelog and no longer need to be duplicated as checked roadmap boxes.

### Fixed

- The sandboxed Electron preload now uses CommonJS, as required by Electron's sandbox loader. Desktop-only IPC features such as media import, Runner pairing, relay controls, and output reveal are available again, with a hidden-window smoke test guarding the bridge.
- `config.py` and `handoff_watcher.py` loaded `.env` too late: `LOCAL_STUDIO_WORKSPACE`, `LOCAL_STUDIO_RENDER_WORKERS`, `HANDOFF_MAX_MEDIA_BYTES`, and `HANDOFF_MAX_BUNDLE_BYTES` were read from the environment at import time, before `.env` was applied, so setting them in `local_studio/.env` silently had no effect (only a real process environment variable worked). `.env` now loads before any setting that depends on it.
- Rendering a project with `render_settings.music_track` set closed the music file's reader before `write_videofile()` was done reading from it, so any render with background music crashed. The music file now stays open for the whole render.

## 0.2.0 — 2026-08-24

### Added

- A public-ready README with quick start, workflow, use cases, roadmap, and local workspace preview.
- Contribution guide, issue templates, and maintainer launch checklist.
- Portable project bundle export/import (`GET /api/projects/{id}/export`, `POST /api/projects/import`, `grok_crew.py bundle export|import`, and an Operations Center card) covering a project's EDL, job history, and artifacts. Source/output media is not included.
- Quality, caption-layout, and platform presets via `GET /api/presets`, selectable in Production's Finish Rack. Platform presets add Feed square (1:1) and Landscape/X (16:9) alongside the existing Reels/TikTok/Shorts (9:16) output.
- Caption background panels (`caption_bg`/`caption_bg_color`) and optional per-clip word-level captions (`word_timings`) for sequential word-by-word reveal instead of one static line.
- Background music mixing (`music_track`, `music_volume`, `music_loop`) mixed under the source audio.
- Renders and Instagram publishes now run on a background worker: starting a job returns immediately, `GET /api/jobs/{id}` reports live progress and supports `wait: true` to block until done, and `POST /api/jobs/{id}/cancel` requests cancellation. A job left `running` after an unclean shutdown is reconciled to `failed` on the next start.
- `local_studio/handoff_watcher.py` lets a remote or cloud-hosted bot that cannot reach this PC's loopback address hand off a finished edit through a dedicated git repository instead. It polls the repository, copies media into the local workspace, and applies the package through the existing `/api/projects/import` and job endpoints — no server changes and no open port. See `local_studio/handoff-guide.json` (or `handoff-guide.ko.json`) for the package format handed to that bot.
- Handoff channel safeguards: a media file extension allow-list, a media size cap, a `bundle.json` size cap, and a per-cycle package limit, all documented in both language handoff guides.
- Bundled an OFL-licensed, Korean-capable bold font (`local_studio/assets/fonts/`) so caption burn-in always has CJK glyph coverage regardless of what's installed on the OS; captions are back on by default now that the font gap that motivated turning them off is closed.
- `local_studio/tests/`: a pytest suite covering workspace path validation, job lifecycle, project bundle import/export, bot execution policy, quality checks, the Instagram auto_upload gate, and HTTP status codes, plus `.github/workflows/ci.yml` running it (and `tsc`/`eslint`) on every push and PR.
- A "LIVE" badge in the site header marks the only two pages where a render, publish, or bot check-in actually happens (Production, Bot Check), matching the existing README table.

### Changed

- Bot Guide now maps every workspace page and explains 18 bot-usable production functions.
- Same-PC bot CLI can print URLs for every workspace page.
- Rendering fails fast with a clear error when no local font can be found for captions, instead of silently skipping them.
- `local_studio/studio_server.py` split into `config.py`, `db.py`, `render.py`, `instagram.py`, and `handlers.py`; `studio_server.py` now holds the project/job/bot/artifact domain logic and the process entrypoint.
- `app/production-console.tsx` and `app/forge.tsx` split: the Finish Rack render-settings form and the Export Room view moved into their own files, cutting both source files roughly in half.
- Render presets pick a faster libx264 encoder preset for compact/draft-quality renders.

### Fixed

- Local Studio now requires the configured `LOCAL_STUDIO_TOKEN` on GET requests as well as POST requests (previously only writes were gated), and rejects any request whose browser `Origin` header is outside `http://localhost:3000` / `http://127.0.0.1:3000`, closing a local cross-site request forgery gap that let an open browser tab drive the service.
- `npm run local` no longer fails with `spawn EINVAL` on Windows when starting the browser dev server — spawning a `.cmd` file (`npm.cmd`) now sets `shell: true`, which recent Node.js versions require on Windows.
- Rendered MP4s now write with `-movflags +faststart`, so the metadata needed to play or seek is at the start of the file instead of the end. Without it, a rendered Reel (or a demo video linked from the README) could appear to stop partway through or fail to play at all in a browser or player that streams the file progressively.
- Pre-render quality checks (`quality_report`) now read the EDL's actual `in`/`out` keys instead of `start`/`end`, so a valid project no longer always fails `clip_ranges`/`duration` checks with `0s`/`error`.
- Queuing an Instagram `auto_upload` now requires the requesting bot's `auto_local` execution policy or an explicit human `approved: true`, matching the gate `render` already had. Previously any process on the PC could force an immediate publish regardless of policy.
- `GET /api/jobs/{id}` and `GET /api/projects/{id}` return 404 for a missing resource instead of 200 with an error body; invalid input on a `GET` route (like a malformed `bot_id`) now returns 400 instead of 500.
- Korean (and other non-Latin-script) captions pulled from Cut Log into a new Production project no longer collapse to the placeholder caption "VIDEO" — the word-extraction regex now matches Unicode letters, not just ASCII.
- The local `Authorization` token check uses a constant-time comparison (`hmac.compare_digest`) instead of `==`.

## 0.1.0 — Initial local workspace

- Local project, bot, operations, render, and optional Instagram delivery workflow.
- Korean and English browser workspace and machine-readable bot guide.
