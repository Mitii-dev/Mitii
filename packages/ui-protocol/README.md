# @mitii/ui-protocol

Zod-validated wire contracts shared by Mitii hosts and UIs. Schemas are the runtime source of truth; TypeScript types are inferred from them. No React, no Node APIs, no host or engine imports.

## Responsibility

Own the shapes that cross a process or webview boundary:

- **VS Code postMessage protocol** (`src/vscode/`) — `WebviewToHostMessageSchema`, `HostToWebviewMessageSchema`, and every view/snapshot they embed (settings, token usage, index status, plan, suspension, file changes, memory, checkpoints, automations).
- **Desktop `/v1/*` + NDJSON** (`src/desktop/`) — health, prompt/resume bodies, the `{ op: 'ready' | 'event' | 'result' | 'error' }` stream envelope, Ollama pull lines, and key JSON route payloads (provider test, memory, checkpoints).

## Input / output

| Entry point | Input | Output |
|---|---|---|
| `parseWebviewToHostMessage(raw)` | untrusted webview payload | `{ ok: true, value }` or `{ ok: false, reason, issues }` |
| `parseHostToWebviewMessage(raw)` | host payload | same result shape |
| `parseDesktopPromptBody(body)` | POST `/v1/prompt` JSON | normalized request or `{ error }` |
| `parseDesktopResumeBody(body)` | POST `/v1/resume` JSON | `{ ok: true, value }` or `{ ok: false, error }` |
| `parseDesktopStreamLine(text)` | one NDJSON line | `WireParseResult<DesktopPromptStreamLine>` |

Rejections use stable reason codes: `expected_object`, `unknown_type`, `invalid_shape` (plus bounded `issues`). Desktop body helpers keep their historical codes (`prompt_required`, `runId_required`, `expected_object`).

## Stages

1. Shape gate: non-objects → `expected_object`.
2. Discriminator gate: unknown `type` / `op` → `unknown_type`.
3. Schema parse: Zod `safeParse`; unknown keys are stripped, malformed optionals in Desktop bodies are dropped.

## Events

`DesktopRunEvent` is `{ type: string }` plus passthrough fields: the event vocabulary belongs to `@mitii/sdk`; the wire contract only guarantees the discriminator. `DesktopMcpAppEventSchema` and `DesktopModelDeltaEventSchema` pin the host-synthesised and delta shapes. `DesktopRunResult` guarantees a string `status`.

## Exports

Everything is exported from the package root. `TokenBudgetPreview` is re-exported from `@mitii/ui-core` and validated structurally as an object.

## Failure modes

Parse helpers never throw. Invalid input yields a rejection result; hosts log and drop the message.

## Non-responsibilities

- Dispatching messages, rendering UI, or HTTP/Electron plumbing.
- Defining SDK run-event vocabulary or engine result shapes.
- Secrets or provider keys (only presence flags cross the wire).

## Scripts

```bash
pnpm --filter @mitii/ui-protocol build
pnpm --filter @mitii/ui-protocol test
```
