# Mitii AI Agent

**Marketplace id:** `mitii.mitii-ai-agent`

Local-first AI coding agent for VS Code. Mitii indexes your repository, answers in Ask mode, plans in Plan mode, and applies changes in Agent mode — with approvals, checkpoints, and OpenAI-compatible providers (Ollama, LM Studio, cloud `/v1` APIs).

![Mitii chat in VS Code](media/mitii-vs-code-chat-ui.png)

## Install

1. In VS Code: **Extensions** → search **Mitii AI Agent** → Install  
   Or open: [Marketplace — mitii.mitii-ai-agent](https://marketplace.visualstudio.com/items?itemName=mitii.mitii-ai-agent)
2. Open a trusted workspace folder
3. Click the Mitii icon in the activity bar
4. Wait for indexing to finish (status in the sidebar / Settings → Index)
5. In **Settings → Provider**, choose:
   - **echo** — local stub (no API key)
   - **Anthropic (Claude)** / **Gemini** / **DeepSeek** / **OpenAI** / **OpenRouter**
   - **Custom OpenAI-compatible** — any `/v1/chat/completions` API

For cloud providers, run **Mitii: Set Provider API Key** (stored in VS Code SecretStorage). Local Ollama/LM Studio usually need no key.

**Requires VS Code 1.124+.** License: AGPL-3.0-or-later.

## What you get

- **Repository-aware context** — SQLite FTS5, symbols, optional vectors, repo map, diagnostics, Git state, and `@` attachments
- **Ask / Plan / Agent** — read-only Q&A, structured plans, controlled edits with cancel / clarify / approve
- **Safety** — configurable approvals, path containment, command policy, pre-write checkpoints, workspace trust
- **Providers** — Echo, Anthropic (Claude), Gemini, and OpenAI-compatible endpoints (DeepSeek, OpenRouter, Azure, Ollama, custom `/v1`)
- **MCP** — optional stdio servers (`mitii.mcp` / `.mitii/mcp.json`); off by default
- **Evidence** — session logs and audit-pack export (secrets redacted). Org SSO / RBAC / SIEM are not included

## Quick commands

| Command | Purpose |
|---|---|
| **Mitii: Open Chat** | Open the sidebar |
| **Mitii: Index Workspace** | Rebuild repository index |
| **Mitii: Show Settings** | Provider, index, MCP, workspace |
| **Mitii: Set Provider API Key** | Store cloud API key in SecretStorage |
| **Mitii: Generate Commit Message** | SCM commit helper |
| **Mitii: Export Session Log** | Export session JSON |
| **Mitii: Export Audit Pack** | Redacted audit bundle |
| **Mitii: Export Shareable Diagnostic** | One redacted markdown file for pasting into online chat help |

## Settings (common)

| Setting | Notes |
|---|---|
| `mitii.provider.type` | `echo`, `openai-compatible`, `anthropic`, or `gemini` |
| `mitii.provider.baseUrl` | e.g. `http://localhost:11434/v1` for Ollama |
| `mitii.provider.model` | Model id |
| `mitii.workspace.rootPathOverride` | Only when no folder is open |
| `mitii.mcp` | MCP server config (disabled by default) |
| `mitii.ui.showReasoning` | Show streamed reasoning when available |
| `mitii.ui.modeDefaults.<mode>.thoroughness` | Low / Medium / High run intensity per mode |

All product settings use the `mitii.*` prefix. Full field reference, save/reflect behavior, and UI map: [SETTINGS.md](./SETTINGS.md).

## Platform notes

VSIX builds are **platform-specific** (they include a native SQLite binding):

- macOS Apple Silicon (`darwin-arm64`)
- macOS Intel (`darwin-x64`)
- Linux x64 (`linux-x64`)
- Windows x64 (`win32-x64`)

Install from the Marketplace for your OS, or pick the matching asset from a [GitHub release](https://github.com/Mitii-dev/Mitii/releases).

## Develop from source

This extension lives in the [Mitii monorepo](https://github.com/Mitii-dev/Mitii) under `apps/vscode`.

```bash
git clone https://github.com/Mitii-dev/Mitii.git
cd Mitii
pnpm run setup
# Cursor on macOS: pnpm run setup:cursor
```

Press **F5** for an Extension Development Host. Details: [docs/INITIAL_LAUNCH.md](https://github.com/Mitii-dev/Mitii/blob/main/docs/INITIAL_LAUNCH.md).

Runtime stack: extension → `@mitii/host` → `@mitii/sdk` → `@mitii/v8`.

```bash
pnpm --filter ./apps/vscode build
pnpm run package   # writes dist-vsix/mitii-ai-agent-<version>-<target>.vsix
```

Release process: [docs/RELEASE.md](https://github.com/Mitii-dev/Mitii/blob/main/docs/RELEASE.md).

## Links

- Website: [mitii.dev](https://mitii.dev)
- Docs: [docs.mitii.dev](https://docs.mitii.dev)
- Issues: [Mitii-dev/Mitii](https://github.com/Mitii-dev/Mitii/issues)
- Architecture: [packages/v8/ARCHITECTURE.md](https://github.com/Mitii-dev/Mitii/blob/main/packages/v8/ARCHITECTURE.md)
