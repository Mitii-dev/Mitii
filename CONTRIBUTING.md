# Contributing to Mitii AI Agent

Thanks for looking at Mitii. This doc covers how to get a dev environment running, where things live in the repo, and what we expect in pull requests.

Maintainer: **codewithshinde** — [codewithshinde@gmail.com](mailto:codewithshinde@gmail.com)

---

## Before you start

Mitii is released under [AGPL-3.0-or-later](LICENSE). By contributing code, you agree that your contributions will be licensed under the same terms. If that doesn't work for your employer or use case, reach out before investing a large amount of time.

For bugs and feature ideas, open an [issue](https://github.com/codewithshinde/thunder-ai-agent/issues) first when the change is non-trivial — saves everyone a rework loop.

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
git clone https://github.com/codewithshinde/thunder-ai-agent.git
cd thunder-ai-agent
pnpm install
pnpm run rebuild:native   # required for better-sqlite3 in VS Code
pnpm run compile
```

Git hooks are installed automatically via `pnpm install` -> `prepare` -> `scripts/install-git-hooks.mjs`. The pre-commit hook stages version bumps from `scripts/bump-version.mjs`.

### Launch the extension

1. Open the repo root in VS Code
2. Press **F5** — this opens an Extension Development Host
3. In the new window, open a project folder (not the thunder-ai-agent repo itself, unless you're dogfooding)
4. Click the Mitii icon in the activity bar

### Watch mode (day-to-day dev)

```bash
pnpm run watch
```

Rebuilds the extension bundle and webview on save. Reload the Extension Development Host window after extension-side changes (`Ctrl/Cmd+R` in the host window, or restart the debug session).

---

## Project layout

```
mitii-ai-agent/
├── src/
│   ├── extension.ts              # VS Code entry point
│   ├── core/                     # Agent logic (editor-agnostic)
│   │   ├── agent/                # AgentLoop, ResearchAgent, PlanExecutor
│   │   ├── apply/                # Patches, checkpoints, auto-apply
│   │   ├── context/              # Retrieval, budgeter, repo map
│   │   ├── indexing/             # Scanner, FTS, vectors, symbols
│   │   ├── llm/                  # Providers (OpenAI-compatible, Echo)
│   │   ├── mcp/                  # MCP client and built-in servers
│   │   ├── memory/               # Long-term memory service
│   │   ├── planning/             # Plan/Act engine, prompts
│   │   ├── safety/               # Policy engine, approvals
│   │   ├── session/              # Session persistence
│   │   ├── skills/               # Skill catalog
│   │   ├── telemetry/            # Logging, session JSONL
│   │   ├── tools/                # Builtin tools, ToolRuntime
│   │   ├── ChatOrchestrator.ts   # Main chat + agent orchestration
│   │   └── ThunderController.ts  # Wires everything together
│   ├── vscode/                   # VS Code adapters
│   │   ├── webview/              # Webview provider + message types
│   │   └── commands.ts
│   └── webview-ui/               # React sidebar (Vite)
│       └── src/
├── test/                         # Vitest tests
├── scripts/                      # Build, audit, hook helpers
├── tools/benchmark/              # @mitii/benchmark — fixtures, enterprise + eval harness
├── dist/                         # Compiled output (gitignored)
├── pnpm-workspace.yaml           # Workspace: tools/*
└── package.json                  # Extension manifest + settings schema
```

**Related repos** (standalone — not part of this package):

- [mitii-docs](https://github.com/codewithshinde/mitii-docs) → docs.mitii.dev
- [mitii-website](https://github.com/codewithshinde/mitii-website) → mitii.dev

Scaffolds may exist at `mitii-docs/` and `mitii-website/` in this tree while you split them out. Brand constants: `src/shared/brand.ts` (sync with each repo's `brand.ts`).

**Rule of thumb:** keep VS Code APIs out of `src/core/`. Core should be testable without launching an editor. Put platform glue in `src/vscode/`. Keep benchmark and eval in `tools/benchmark/` — they are not extension runtime code.

### Benchmark and eval

```bash
pnpm run compile:cli
pnpm run benchmark:smoke
pnpm run eval:preflight       # before real-runtime eval
pnpm run eval:generate
pnpm run eval:standard -- --provider openai-compatible \
  --base-url http://localhost:11434/v1 --model qwen3-coder:30b --limit 50
```

See [tools/benchmark/README.md](tools/benchmark/README.md) for sharded runs, Ollama matrix, and Inspect AI.

---

## Common tasks

### Run tests

```bash
pnpm run rebuild:node   # if better-sqlite3 fails under vitest
pnpm test               # full suite
pnpm run test:watch     # watch mode
pnpm run smoke          # smoke tests only
```

### Typecheck

```bash
pnpm run lint           # tsc --noEmit
```

### Build a VSIX

```bash
pnpm run compile
pnpm run package        # outputs thunder-ai-agent-<version>.vsix
```

Install locally: **Extensions → ... → Install from VSIX**.

### Native module rebuild

| Scenario | Command |
|----------|---------|
| F5 / VS Code extension host | `pnpm run rebuild:native` |
| Cursor extension host | `THUNDER_EDITOR=cursor pnpm run rebuild:native` |
| Local vitest | `pnpm run rebuild:node` |
| Both | `pnpm run rebuild:all` |

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

- TypeScript strict mode - `pnpm run lint` must pass
- Match surrounding patterns: no drive-by refactors in unrelated files
- Logging via `createLogger('ComponentName')` from `src/core/telemetry/Logger.ts`, not raw `console.log`
- New VS Code settings go in `package.json` contributes **and** `src/core/config/schema.ts` **and** `src/core/config/vscodeSettings.ts`
- Webview message types: update both `src/vscode/webview/messages.ts` and the React handlers in `src/webview-ui/`

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
3. Run `pnpm run lint` and `pnpm test`
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
