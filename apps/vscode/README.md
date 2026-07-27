# @mitii/vscode

VS Code extension package. Owns `contributes`, `activationEvents`, and `engines.vscode`.

```bash
pnpm --filter @mitii/vscode build
pnpm --filter @mitii/vscode package
```

## Host surface

- `@mitii/sdk` only (no legacy kernel)
- Premium React sidebar (`webview-ui`): Chat | Settings
- Modes: Ask / Plan / Agent, `@` context pins, live activity stream
- Settings tabs: Workspace · Index · Provider · MCP
- Cancel / clarify / approve in-chat (fallback QuickInput on non-webview runs)
- Provider settings: `mitii.provider.type|baseUrl|model` (openai-compatible works without API key for Ollama/LM Studio)
- Provider UI: model dropdown, Test connection (`GET /models` / chat ping), session token meter
- UI prefs: `mitii.ui.showReasoning|reasoningPreviewMaxChars|depth`
- Workspace override: `mitii.workspace.rootPathOverride`
- MCP: `mitii.mcp` + `.mitii/mcp.json` — off by default (empty install list). Settings store can add/remove builtins (Filesystem, Sequential Thinking, Memory, Puppeteer) or custom servers; stdio runtime registers tools as `mcp__*` in Agent mode only
- Token meter: chat I/O plus context-window breakdown (Prompt, Conversation, Repomap, MCP tools, …)
- API key: `Mitii: Set Provider API Key` → SecretStorage `mitii.provider.apiKey` (required for cloud endpoints only)
- Index / commit-message / session export commands

F5: `docs/INITIAL_LAUNCH.md` · Release: `docs/RELEASE.md`
