# Activation modules

`../extension.ts` exports `activate()` and only composes the pieces below.

## Responsibility

Register VS Code commands, listeners, and the shared activation runtime for the Mitii extension.

| File | Owns |
|---|---|
| `runtime.ts` | `ActivationRuntime` (client, output channel, sidebar handle) via `createActivationRuntime` |
| `sidebarCommands.ts` | `registerSidebarCommands`: open chat, review changes, restore checkpoint, inline diff, settings |
| `indexing.ts` | `createIndexWorkspace`, `registerIndexingCommands`, `registerIndexingListeners` |
| `writingRecipes.ts` | PR summary, changelog, release-prep commands |
| `exportCommands.ts` | Session-log and audit-pack export/open commands |
| `apiKeyCommands.ts` | Secret-storage API key set/clear commands |
| `editorSync.ts` | Active-editor sync to the sidebar |

## Contract

Each `register*` function receives the runtime (and the sidebar where needed) and returns `Disposable[]`
that `activate()` pushes to `context.subscriptions`.

## Non-responsibilities

No message routing or settings logic (see `../sidebar/`), no engine/V8 behavior.
