# Sidebar host modules

Owns everything behind `MitiiSidebarProvider` (`../sidebar.ts`), which stays a thin facade: it builds the
services below, implements `SidebarContext`, and delegates.

## Responsibility

Translate validated webview messages into host actions and push state back to the webview.

- **Input:** `WebviewToHostMessage` already accepted by `acceptWebviewMessage` (`../webviewInbound.ts`).
- **Output:** `HostToWebviewMessage` posts through `ctx.post`, VS Code config writes, SDK client calls.

## Stages / ownership

| Area | Files |
|---|---|
| Routing | `messageRouter.ts` (exhaustive switch), `handlers/*` (threads, files, review, context, checkpoints/memory) |
| Settings | `settingsService.ts`, `settingsReaders.ts`, `settingsWriters.ts` (`ConfigWriter`), `settingsUiWriter.ts`, `configValues.ts` |
| Index | `indexOrchestrator.ts` (ensure/refresh/reindex, status publishing), `indexDescriptor.ts` (pure projections) |
| Runs | `runController.ts`, `runAsk.ts`, `runHandlers.ts`, `runFinalize.ts`, `runPrompt.ts`, `runSuspension.ts`, `reviewFindingsSync.ts` |
| Token meter | `tokenUsage.ts` (`TokenUsageTracker`) |
| Webview shell | `bootstrap.ts` (`sendBootstrap`), `html.ts`, `mcpAppListener.ts` |
| Shared state | `session.ts` (`SidebarSessionState`), `context.ts` (`SidebarContext`), `services.ts`, `hostOptions.ts` |

## Ports

`SidebarContext` is the only seam services use. They always call back through the provider
(`ctx.post`, `ctx.sendBootstrap`, `ctx.secrets`, `ctx.refreshDiscoveredModels`) so tests can replace those members.

## Failure modes

Handlers surface failures as `{ type: 'error' }` posts or `settings.saved { ok: false }`; run failures are recorded
by `recordRunFailure` in `runFinalize.ts`. Nothing here throws into the webview message loop.

## Non-responsibilities

No V8 pipeline logic (delegated to `@mitii/sdk`), no VS Code command registration (see `../activation/`), no webview
rendering (see `webview-ui/`).
