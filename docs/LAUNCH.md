# Grok Crew launch checklist

Use this before the first public GitHub release.

## Repository basics

- [x] The README uses the public GitHub clone URL.
- [x] Add a license (Business Source License 1.1 — source-available, not open source; converts to MIT on 2030-08-23).
- [x] Add a concise repository description. (Already set on GitHub: "Local-first short-form video production desk for same-PC AI agents.")
- [x] Add relevant GitHub topics. (Already set on GitHub: `ai-agents`, `ffmpeg`, `instagram-reels`, `local-first`, `python`, `self-hosted`, `short-form-video`, `typescript`, `video-editing`.)
- [x] Create a `v0.1.0` release using the changelog notes. (Published 2026-08-23 as "First public demo".)
- [x] Create a `v0.2.0` release using the changelog notes. (2026-08-24: the render/QA/security fixes and file-split work in this pass.)
- [x] Review `npm audit` before release. Do not use a forced dependency upgrade without rebuilding and testing the workspace. (2026-08-24: 13 findings, 1 low / 12 high, all in dev-only build tooling -- Cloudflare Workers preview stack (`wrangler`/`miniflare`/`ws`/`undici`/`sharp`), `next`, `vite`, `vinext`, `react-server-dom-webpack`, `postcss`, `esbuild`. None are semver-major fixes, but the `vinext` fix bumps `1.0.0-beta.3` → `1.0.0-beta.8`, which is exactly the kind of beta jump this project deliberately exact-pins against without testing first -- so this needs a deliberate, tested upgrade pass, not `npm audit fix`, and not folded into an unrelated change.)

## First experience

- [x] Run the Quick Start from a fresh clone on Windows, macOS, or Linux. (2026-08-24, Windows: `npm ci`, `npm run dev`, and `python local_studio/studio_server.py` all verified working individually this session; the full `npm run local` one-command orchestration itself was not re-run end-to-end.)
- [x] Confirm the production preview image still matches the current interface. (2026-08-25: checked `public/readme/production-workspace.png` against a live `npm run dev` render of `/production` — section order, copy, and Finish Rack layout still match. The only change since this screenshot was taken is the language switcher, which now lists `ko`/`en`/`zh`/`ja` instead of two languages; not visible in a collapsed dropdown, so the image doesn't need retaking.)
- [x] Confirm `python local_studio/grok_crew.py contract` works from a fresh terminal. (2026-08-24, Windows)
- [x] Add one short example project or safe sample media only if you have rights to share it. (`sample-project/` already ships a portable project bundle and its own README; `npm run sample` renders it end to end.)

## Announcement

- [ ] Share the problem: short-form bot editing loses its context across prompts, export jobs, and delivery steps.
- [ ] Show the first win: local source → cut map → MP4 → optional upload.
- [ ] Explain the local-first boundary and optional Instagram setup honestly.
- [ ] Ask for one specific kind of feedback, such as caption workflow, cut-map design, or local render reliability.

## Community follow-through

- [ ] Reply to early issues with a reproduction status or next action.
- [ ] Tag duplicate requests and turn repeated feedback into a small roadmap item.
- [ ] Keep pull requests focused and update the changelog for user-visible behavior.
