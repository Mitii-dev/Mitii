# Contributing to Mitii AI Agent

Thanks for looking at Mitii. This doc covers how to get a dev environment running, where things live in the repo, and what we expect in pull requests.

Maintainer: **codewithshinde** — [codewithshinde@gmail.com](mailto:codewithshinde@gmail.com)

---

## Before you start

Mitii is released under [AGPL-3.0-or-later](LICENSE). By contributing code, you agree that your contributions will be licensed under the same terms. If that doesn't work for your employer or use case, reach out before investing a large amount of time.

For bugs and feature ideas, open an [issue](https://github.com/Mitii-dev/Mitii/issues) first when the change is non-trivial — saves everyone a rework loop.

---

## Prerequisites

| Tool | Version |
|------|---------|
| VS Code | 1.85+ (or Cursor, with native rebuild noted below) |
| Node.js | 20+ |
| pnpm | 10.13+ |
| git | any recent version |

Optional but useful for full feature coverage:

- A local Ollama or other OpenAI-compatible endpoint for manual testing
- `@xenova/transformers` (installed as optional dependency) for vector search
- `web-tree-sitter` + `tree-sitter-wasms` for symbol extraction

---

## Getting set up

```bash
git clone https://github.com/Mitii-dev/Mitii.git
cd Mitii
pnpm install
pnpm run build:all   # packages + Electron better-sqlite3 staged into apps/vscode/dist/native
```

Or: `pnpm run setup` / `pnpm run setup:cursor` (install + Node rebuild + build + Electron rebuild).

Git hooks are installed automatically via `pnpm install` -> `prepare` -> `scripts/install-git-hooks.mjs`. The pre-commit hook stages version bumps from `scripts/bump-version.mjs`.

### Launch the extension

1. Open the repo root in VS Code / Cursor
2. Press **F5** (loads `apps/vscode` via `.vscode/launch.json`)
3. In the Extension Development Host, open a project folder
4. Click the Mitii icon in the activity bar

Automated F5 gate (no Extension Host): `pnpm run f5:verify` — see [docs/INITIAL_LAUNCH.md](docs/INITIAL_LAUNCH.md).

### Watch mode (day-to-day dev)

```bash
pnpm --filter @mitii/vscode build
```

Rebuild the extension package after host changes. Phase 17 F5 wiring is complete (`docs/INITIAL_LAUNCH.md`). Reload the Extension Development Host after rebuilds.

---

## Project layout

Canonical packaging layout: [docs/REPO_LAYOUT.md](docs/REPO_LAYOUT.md). Canonical V8 architecture: [packages/v8/ARCHITECTURE.md](packages/v8/ARCHITECTURE.md).

```
mitii-ai-agent/
├── packages/v8/                  # @mitii/v8 — host-neutral runtime
├── packages/sdk/                 # @mitii/sdk — public API over V8
├── apps/vscode/                  # VS Code extension
├── apps/cli/                     # Headless CLI
├── tests/                        # Phase 14 architecture, consumer, solid benchmark
├── docs/
├── scripts/
├── pnpm-workspace.yaml
└── package.json                  # Private workspace orchestrator
```

**Related repos** (standalone — not part of this package):

- [mitii-docs](https://github.com/codewithshinde/mitii-docs) → docs.mitii.dev
- [mitii-website](https://github.com/codewithshinde/mitii-website) → mitii.dev

**Rule of thumb:** hosts use `@mitii/sdk` only. Do not import V8 `actions/` / `internal/`. Prefer `packages → apps` dependency direction. Do not recreate purged `legacy/` or `src/kernel`.

### Benchmark

```bash
pnpm run benchmark:validate
pnpm run benchmark
```

See [tests/benchmark/README.md](tests/benchmark/README.md) and [docs/TESTS.md](docs/TESTS.md). The old `tools/benchmark` harness was purged with `legacy/` (2026-07-26).

---

## Common tasks

### Run tests

```bash
pnpm test               # architecture + selected Vitest suites (auto-heals SQLite ABI)
pnpm run test:v8        # @mitii/v8 package tests
pnpm run test:watch     # watch mode
```

If `better-sqlite3` was last built for Electron, pretest runs `rebuild:node` automatically.

### Typecheck

```bash
pnpm run typecheck      # typecheck v8 + sdk + cli + vscode
```

### Build a VSIX

```bash
pnpm run build
pnpm run package        # outputs mitii-ai-agent-<version>.vsix via @mitii/vscode
```

Install locally: **Extensions → ... → Install from VSIX**.

### Native module rebuild

| Scenario | Command |
|----------|---------|
| Full F5-ready build | `pnpm run build:all` |
| F5 / VS Code extension host | `pnpm run rebuild:native` |
| Cursor extension host | `MITII_EDITOR=cursor pnpm run rebuild:native` |
| Local vitest / CLI only | `pnpm run rebuild:node` |
| Both (Electron staged + Node restored) | `pnpm run rebuild:all` |

`rebuild:native` stages `better_sqlite3.node` into `apps/vscode/dist/native`, then restores the system Node ABI in `node_modules`. The extension host loads the staged Electron binding; Vitest/CLI use `node_modules`. Without the staged Electron binding, code/text indexes fail in the Extension Host.

If SQLite throws on startup, this is almost always the fix.

### Audit scripts

```bash
pnpm run audit:dependencies
pnpm run audit:dead-code
pnpm run check:circular-deps
pnpm run audit:engines
```

These are useful before large refactors. Not required on every PR, but run them if you touch imports or dependencies.

---

## Making changes

### Branch naming

Keep it simple: `fix/approval-queue-stall`, `feat/lancedb-backend`, `docs/contributing-update`.

### Commit messages

Follow what's already in the log — short imperative subject, optional body:

```
feat: add session log export command
fix(core): cache context retrieval across turns
chore: bump vitest to 1.6
```

The pre-commit hook may stage a version bump in `package.json`. Include that in your commit if it runs.

### Code style

- TypeScript strict mode - `pnpm run typecheck` must pass
- Match surrounding patterns: no drive-by refactors in unrelated files
- Prefer structured logging in V8/SDK; do not log secrets
- New VS Code settings go in `apps/vscode/package.json` contributes (`mitii.*` only)
- Do not recreate purged `legacy/` or import vaulted kernel paths from product packages

### Adding a tool

1. Define the tool in `src/core/tools/builtinTools.ts` (or wire an MCP tool)
2. Register it in `src/core/tools/index.ts`
3. Add policy rules in `src/core/safety/ToolPolicyEngine.ts` if it's not obviously read-only
4. Add tests if the tool has non-trivial logic

### Adding a setting

1. `package.json` → `contributes.configuration.properties`
2. Zod schema in `src/core/config/schema.ts`
3. Reader in `src/core/config/vscodeSettings.ts`
4. UI control in `src/webview-ui/src/components/SettingsPanel.tsx` if user-facing

---

## Pull requests

1. Fork and branch from `main`
2. Make your change; keep the diff focused
3. Run `pnpm run typecheck` and `pnpm test`
4. Manually smoke-test in the Extension Development Host if you touched agent behavior or UI
5. Open a PR against `main` with:
   - What changed and why (2–4 sentences is fine)
   - How you tested it
   - Screenshots or a short recording for UI changes

I review PRs as time allows. Small, well-scoped changes land faster.

---

## Reporting bugs

Include:

- VS Code (or Cursor) version
- Mitii version (`package.json` → `version`)
- OS
- Provider config (model name and base URL — no API keys)
- Steps to reproduce
- Relevant session log from `.mitii/logs/` if you have one (`Mitii: Export Session Log`)

---

## Security

Don't open public issues for exploitable vulnerabilities. Email **codewithshinde@gmail.com** with details and we'll coordinate a fix before disclosure.

---

## Questions

GitHub Discussions aren't set up yet — issues tagged `question` or a direct email to codewithshinde@gmail.com both work.
