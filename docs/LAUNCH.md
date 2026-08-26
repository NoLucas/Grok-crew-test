# Grok Crew launch checklist

Use this before the first public GitHub release.

## Repository basics

- [x] The README uses the public GitHub clone URL.
- [x] Add a license (Business Source License 1.1 — source-available, not open source; converts to MIT on 2030-08-23).
- [x] Add a concise repository description. (Already set on GitHub: "Local-first short-form video production desk for same-PC AI agents.")
- [x] Add relevant GitHub topics. (Already set on GitHub: `ai-agents`, `ffmpeg`, `instagram-reels`, `local-first`, `python`, `self-hosted`, `short-form-video`, `typescript`, `video-editing`.)
- [x] Create a `v0.1.0` release using the changelog notes. (Published 2026-08-23 as "First public demo".)
- [x] Create a `v0.2.0` release using the changelog notes. (2026-08-24: the render/QA/security fixes and file-split work in this pass.)
- [x] Write `v1.0.0` notes in `docs/RELEASE_NOTES.v1.0.md` and `CHANGELOG.md`. Publishing the GitHub release and tag stays operator-owned.
- [x] Review `npm audit` before release. Do not use a forced dependency upgrade without rebuilding and testing the workspace. (2026-08-26: `npm audit` and `npm audit --omit=dev` report 0 vulnerabilities. `vinext` is installed and locked at `1.0.0-beta.8`, which is the latest published `1.0.0-beta.*`. The 2026-08-24 note about 13 findings and a deferred beta.3→beta.8 jump is stale. Do not run `npm audit fix --force`. Do not bump wrangler/miniflare or a future vinext 1.0.0 stable in this pass.)

## First experience

- [x] Run the Quick Start from a fresh clone on Windows, macOS, or Linux. (2026-08-24, Windows: `npm ci`, `npm run dev`, and `python local_studio/studio_server.py` all verified working individually this session; the full `npm run local` one-command orchestration itself was not re-run end-to-end.)
- [x] Confirm the production preview image still matches the current interface. (2026-08-25: checked `public/readme/production-workspace.png` against a live `npm run dev` render of `/production` — section order, copy, and Finish Rack layout still match. The only change since this screenshot was taken is the language switcher, which now lists `ko`/`en`/`zh`/`ja` instead of two languages; not visible in a collapsed dropdown, so the image doesn't need retaking.)
- [x] Confirm `python local_studio/grok_crew.py contract` works from a fresh terminal. (2026-08-24, Windows)
- [x] Add one short example project or safe sample media only if you have rights to share it. (`sample-project/` already ships a portable project bundle and its own README; `npm run sample` renders it end to end.)

## Announcement

Ready-to-post copy is in `docs/ANNOUNCEMENT.md`. This repository does not post it for you.

- [x] Draft the problem, first win, local-first boundary, and one feedback ask (`docs/ANNOUNCEMENT.md`).
- [ ] Publish that draft on the channel you actually use (social, Discord, HN, or a GitHub Release note).

## Community follow-through

- [x] Checked [NoLucas/Grok-crew-test](https://github.com/NoLucas/Grok-crew-test) issues on 2026-08-26: **0 open issues**, so there is nothing to reply to or mark duplicate.
- [x] User-visible behavior is recorded in `CHANGELOG.md` Unreleased. Keep new PRs focused the same way.

## External credentials (not in this repo)

This repository does **not** invent, register, or ship Instagram, TikTok, YouTube, or GitHub OAuth apps, Apple certificates, or notarization credentials. `GET /api/v2/launch` and `npm run launch:verify` report env **name presence only**. `external_gates.oauth_apps.ready`, `code_signing.ready`, and `auto_update_install.ready` stay `false` even when those names are set — presence is not registration.

Do not commit `local_studio/.env`, tokens, `.p12`/`.p8` files, or certificate passwords. Use empty placeholders from `local_studio/.env.example`.

Publish already works with operator-supplied **access tokens** (`INSTAGRAM_ACCESS_TOKEN`, `TIKTOK_ACCESS_TOKEN`, `YOUTUBE_ACCESS_TOKEN`). Official OAuth **apps** are a separate gate. App id/secret readers (`INSTAGRAM_APP_ID`, `TIKTOK_CLIENT_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, …) inventory operator-owned apps; they do not start a built-in OAuth dance for those platforms.

### GitHub OAuth app (desktop device flow)

Token login in the desktop app works with no OAuth app. Device flow needs an operator-owned GitHub OAuth app **and** `GROK_CREW_GITHUB_CLIENT_ID` on the **Electron process** (the shell that runs `npm run desktop`, a launch agent, or CI). `desktop/git-relay.mjs` requests scopes `repo` and `read:user`. Device flow does not use a client secret.

1. Open [GitHub Developer settings → OAuth apps](https://github.com/settings/developers) (or org Settings → Developer settings → OAuth apps).
2. Follow [Creating an OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app): application name, **your** homepage URL, **your** authorization callback URL.
3. Enable **Device Flow** on that app ([authorizing OAuth apps — device flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow)).
4. Copy the app’s Client ID into the Electron environment as `GROK_CREW_GITHUB_CLIENT_ID`. Leave the value out of git.

### Instagram / Meta OAuth app (optional; publish tokens already work)

1. In the [Meta App Dashboard](https://developers.facebook.com/apps), create a **Business** type app and add the Instagram product. Official walkthrough: [Create an Instagram app](https://developers.facebook.com/documentation/instagram-platform/create-an-instagram-app).
2. For publish tests without implementing login yet, generate a long-lived Instagram user token from the dashboard ([Get started](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started)) and put `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_USER_ID`, and `INSTAGRAM_API_VERSION` in `local_studio/.env`.
3. If you later own a Meta app, record `INSTAGRAM_APP_ID` and `INSTAGRAM_APP_SECRET` in the same file. Those names are optional and are **not** required for token publish. App Review is required before live users; this repo does not submit that review.

### TikTok OAuth app (optional; publish tokens already work)

1. Create a TikTok developer account and connect an app under [Manage apps](https://developers.tiktok.com/apps). Official walkthrough: [Register Your App](https://developers.tiktok.com/doc/getting-started-create-an-app). Credentials on that page are **Client key** and **Client secret**.
2. Add **Content Posting API**, enable Direct Post, and request `video.publish`. Unaudited clients stay private (`SELF_ONLY`); this project already honors `TIKTOK_APP_AUDITED`. Official posting guide: [Content Posting API](https://developers.tiktok.com/doc/content-posting-api-get-started).
3. Publish today with `TIKTOK_ACCESS_TOKEN` in `local_studio/.env`. Optionally record `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`. Those names are not required for token publish. This repo does not submit TikTok app review.

### YouTube / Google OAuth client (optional; publish tokens already work)

1. In [Google Cloud credentials](https://console.cloud.google.com/apis/credentials), create a project, enable **YouTube Data API v3**, and create **OAuth 2.0** credentials (installed / desktop is the usual shape). Official notes: [Obtaining authorization credentials](https://developers.google.com/youtube/registering_an_application).
2. Publish today with `YOUTUBE_ACCESS_TOKEN` in `local_studio/.env`. Optionally record `GOOGLE_OAUTH_CLIENT_ID`. That name is not required for token publish. Configure the OAuth consent screen and scopes in **your** Cloud project; this repo does not create one.

### macOS signing and notarization

`package.json` → `build.mac.notarize` is **`false`**. Do not flip it until you have real Apple credentials **and** you intend to notarize. This repo does not set `"notarize": true`.

1. Join the [Apple Developer Program](https://developer.apple.com/programs/) and create a **Developer ID Application** certificate (required for DMG distribution outside the Mac App Store).
2. Export the certificate as `.p12` and supply it to electron-builder as `CSC_LINK` (path, `file://`, HTTPS, or base64) plus `CSC_KEY_PASSWORD`. Official env list: [electron-builder code signing](https://www.electron.build/docs/features/code-signing/).
3. For notarization, create an [app-specific password](https://appleid.apple.com) (do not use your Apple ID password) and set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`. Official builder steps: [macOS notarization](https://www.electron.build/docs/features/code-signing/notarization/). Apple’s overview: [Notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).
4. Only after those env names exist on the **build** machine, an operator may flip `build.mac.notarize` to `true` in a private or release branch. Until then, unsigned builds can still check GitHub releases and open the download URL; in-place auto-update install stays external (`auto_update_install.ready` remains `false`).

### Where to put the names

| Variable | Process | Purpose |
| --- | --- | --- |
| `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_USER_ID`, `INSTAGRAM_API_VERSION` | Local Studio (`local_studio/.env`) | Token publish |
| `TIKTOK_ACCESS_TOKEN`, `TIKTOK_APP_AUDITED` | Local Studio | Token publish |
| `YOUTUBE_ACCESS_TOKEN` | Local Studio | Token publish |
| `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` | Local Studio | Optional Meta app inventory |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | Local Studio | Optional TikTok app inventory |
| `GOOGLE_OAUTH_CLIENT_ID` | Local Studio | Optional Google client inventory |
| `GROK_CREW_GITHUB_CLIENT_ID` | Electron process | Optional GitHub device flow |
| `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | electron-builder / CI | Signing and notarization |
