# Claude Code working agreement

This repository is jointly maintained with Codex. Read
[`docs/AI_COLLABORATION.ko.md`](docs/AI_COLLABORATION.ko.md) before editing.

## Repository and branch safety

- The only permitted GitHub push target is `https://github.com/NoLucas/Grok-crew-test.git`.
- Never push to `origin`; this clone's `origin` may point at a different repository.
- Never commit directly to `main`. Use a short-lived branch named `claude/<workstream>`.
- Start from the exact `Grok-crew-test/main` commit named in the task packet.
- Do not merge, tag, publish a release, or change GitHub settings. The maintainer owns those actions.

## Scope safety

- A task packet must list allowed paths. Do not edit files outside that allowlist.
- Do not change JSON Schemas, SQLite migrations, preload IPC, `/api/v2` contracts, crypto,
  credential storage, publishing code, or release configuration unless the task explicitly assigns
  that contract work to Claude Code.
- Do not reformat unrelated files or combine opportunistic cleanup with a feature.
- Never commit tokens, `.env` files, private media, SQLite databases, generated renders, build output,
  installers, relay payloads, or decrypted transcripts/thumbnails.
- Preserve sandboxing, context isolation, `nodeIntegration:false`, loopback authentication, immutable
  timeline revisions, lock protection, signature verification, and stale-revision rejection.

## Default Claude Code role

Claude Code is the bounded feature implementer. Unless a task says otherwise, it owns only the
assigned React interaction/components and their focused tests. Codex is the integration owner for
contracts, Electron main/preload, the Python sidecar, database migration, render/publish pipelines,
cross-layer regression checks, release notes, and final integration.

If the requested UI needs a contract change, stop and leave a handoff that names the missing field,
operation, validation rule, and caller. Do not invent a second local contract.

## Required checks

Run the smallest focused test during development, then before handoff run:

```powershell
npm run verify:core
python -m pytest -q local_studio/tests
```

For Electron main/preload/tray changes, also run:

```powershell
npm run verify:desktop
```

Report the exact commands, pass/fail counts, files changed, known limitations, and the final commit
SHA using the handoff template in `docs/AI_COLLABORATION.ko.md`.
