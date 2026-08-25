# Changelog

All notable changes to Grok Crew are documented here.

## Unreleased

### Added

- P1-02 track editing in the desktop timeline: persistent clip groups, track lock/mute/solo controls, marker add/remove, frame-based snapping, range and additive multi-selection, and atomic movement of a selected group.
- P1-03 persistent undo/redo history: every action creates a new immutable revision, redo survives restart, a divergent edit clears the redo branch, and the desktop exposes buttons plus standard keyboard shortcuts.
- Focused backend and UI tests for P1-02 persistence, locked-item protection, selection behavior, marker validation, snapping geometry, and multi-clip movement.

### Changed

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
