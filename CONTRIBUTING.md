# Contributing to Grok Crew

Thanks for helping make local bot-assisted video editing more useful.

## Before you start

1. Read the current [README](README.md) and [Bot Guide](local_studio/bot-guide.json).
2. Search existing issues before opening a new one.
3. Keep every test file, project record, and rendered asset inside `local_studio/workspace/`.
4. Never commit `.env` files, access tokens, private media, SQLite databases, or generated renders.

## Report a bug

Please include:

- What you expected and what happened instead
- Your operating system, Node.js version, and Python version
- The smallest safe set of steps that reproduces the problem
- The local job error or Bot Check activity, with secrets removed

## Propose a feature

Describe the editing problem first, then the smallest workflow that solves it. Good proposals name the target user, the expected local result, and how the feature fits the bot guide or CLI contract.

## Pull requests

- Keep one clear change per pull request.
- For Codex/Claude Code work, follow the ownership, task-packet, validation, and handoff rules in
  [docs/AI_COLLABORATION.ko.md](docs/AI_COLLABORATION.ko.md). One implementation owner and an explicit
  path allowlist are required for each AI-assisted pull request.
- Update the Korean and English bot guide together when bot behavior changes.
- Add or update documentation for user-visible behavior.
- Run `npm run build` and Python syntax validation before requesting review.
- Do not add a cloud dependency, remote bot service, or credential collection without an explicit design discussion. (`local_studio/handoff_watcher.py`'s git-branch handoff is not an exception to this: it grants no network access to Local Studio — it only lets an operator-approved script running on this PC pull an offline package and replay it through the existing local API.)

## Dependency notes

The web workspace runs on `vinext` (`1.0.0-beta.8`, currently the latest published `1.0.0-beta.*`), a beta Next.js-on-Vite runtime. `package.json` allows a caret on that beta; do not jump to a future `1.0.0` stable or run `npm audit fix --force` without a dedicated rebuild and `npm run verify:core`. If a `vinext` upgrade breaks the build, first try reverting to the last known lockfile version rather than chasing the next beta. `vinext` isn't just a CLI wrapper here — `vite.config.ts` imports it directly as a Vite plugin (`vinext()`) and uses `vinext/server/app-router-entry` as the app's own entry point, so if `vinext` becomes unmaintained, migrating off it means replacing that plugin and entry point, not just swapping a script command. That migration hasn't been scoped or attempted, so budget real time for it rather than assuming it's a drop-in swap.

## Code of conduct

Be concise, constructive, and respectful. Focus feedback on the workflow and the implementation, never the contributor.
