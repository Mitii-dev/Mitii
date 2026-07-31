# mitii-agent

VS Code extension for Mitii: local-first AI coding agent with repository-aware context, Ask / Plan / Agent modes, approvals, checkpoints, and OpenAI-compatible providers (including Ollama / LM Studio).

## Install

- **Marketplace / Open VSX** — search for Mitii (when published), or install a VSIX from a release.
- **From source** (this monorepo):

```bash
pnpm run setup
# or Cursor on macOS:
pnpm run setup:cursor
```

Press **F5** to launch an Extension Development Host. See [docs/INITIAL_LAUNCH.md](../../docs/INITIAL_LAUNCH.md).

Requires **VS Code 1.85+** and **Node.js 20+** for development. License: **AGPL-3.0-or-later**.

Runtime path: extension → `@mitii/host` → `@mitii/sdk` → `@mitii/v8` (no legacy kernel).

## Features

- Premium React sidebar (`webview-ui`): Chat | Settings
- Modes: Ask / Plan / Agent, `@` context pins, live activity stream
- Settings tabs: Workspace · Index · Provider · MCP
- Cancel / clarify / approve in-chat (fallback QuickInput on non-webview runs)
- Provider settings: `mitii.provider.type|baseUrl|model` (openai-compatible works without API key for Ollama/LM Studio)
- Provider UI: model dropdown, Test connection (`GET /models` / chat ping), session token meter
- UI prefs: `mitii.ui.showReasoning|reasoningPreviewMaxChars|depth`
- Workspace override: `mitii.workspace.rootPathOverride`
- MCP: `mitii.mcp` + `.mitii/mcp.json` — off by default. Settings can add builtins (Filesystem, Sequential Thinking, Memory, Puppeteer) or custom stdio servers; tools register as `mcp__*` in Agent mode only
- Token meter: chat I/O plus context-window breakdown
- API key: **Mitii: Set Provider API Key** → SecretStorage `mitii.provider.apiKey` (cloud endpoints only)
- Index / commit-message / session export / audit-pack commands

## Package from source

```bash
pnpm --filter ./apps/vscode build
pnpm --filter ./apps/vscode package
```

Release gates: [docs/RELEASE.md](../../docs/RELEASE.md).

## Links

- Product README: [../../README.md](../../README.md)
- Architecture: [`packages/v8/ARCHITECTURE.md`](../../packages/v8/ARCHITECTURE.md)
- Docs: [docs.mitii.dev](https://docs.mitii.dev)
