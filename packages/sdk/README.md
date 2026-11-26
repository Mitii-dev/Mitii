# `@mitii/sdk`

Host-neutral programmatic API over [`@mitii/v8`](https://www.npmjs.com/package/@mitii/v8). Apps and tests use this package instead of importing V8 internals.

## Install

```bash
npm install @mitii/sdk
```

Requires **Node.js 20+**. Depends on `@mitii/v8`. License: **AGPL-3.0-or-later**.

Published on `v*` release tags. For local development, consume from the workspace (`pnpm --filter @mitii/sdk`). Legacy npm `@mitii/sdk@2.7.x` is a different API surface.

## Quick start

```ts
import { createMitiiClient, EchoLlmPort } from '@mitii/sdk';
import type { LlmPort } from '@mitii/v8';

// Hosts inject real provider ports (AnthropicLlmPort, GeminiLlmPort,
// OpenAiCompatibleLlmPort). Echo is for local smoke only.
const understandingLlm: LlmPort = new EchoLlmPort();
const runLlm = new EchoLlmPort();

const client = createMitiiClient({
  understandingLlm,
  runLlm,
  workspaceRoot: process.cwd(),
  defaultMode: 'ask',
});

const run = client.start({
  prompt: 'What is recursion?',
  mode: 'ask',
});

for await (const event of run.events) {
  if (event.type === 'model_delta' && event.preview) {
    process.stdout.write(event.preview);
  }
}

const result = await run.result;
// result.status: completed | failed | cancelled | suspended
```

## Public surface

| API | Role |
|---|---|
| `createMitiiClient(options)` | Compose default V8 facades; inject `LlmPort`s (secrets stay on the port) |
| `client.start(input)` | Intake → run handle. Default `startPath: 'auto'`: all modes → runtime shell |
| `client.startRuntimeShell(input)` | Explicit runtime pump 1–11 (`RuntimeRunResult`); requires `enableRuntimeShell` (default true) |
| `client.getRuntime()` | Dual-run `RuntimePipeline` |
| `client.resolveStartPath(mode?)` | `'engine' \| 'runtime'` for current settings |
| `run.events` | Async iterable of V8 `RunEvent` |
| `run.result` | Terminal `AgentRunResult` |
| `run.cancel()` | Cancel in-flight model/tool work |
| `client.resume(input)` | Resume after suspend — runtime if the run started on the shell; else engine |
| `client.publishRepositoryState(input)` | Optional; calls V8 Repository State facade |

`startPath`: `'auto'` (default, all modes → runtime shell wrap) · `'runtime'` · `'engine'` (**deprecated** event-bus escape). Opt out with `enableRuntimeShell: false`.

Filesystem checkpoints, skills catalogs, search, and indexing live in **`@mitii/host`** (or your own port implementations). The SDK stays host-neutral.

Bundled default skills ship beside this package under [`skills/`](./skills/). Hosts load them via `createFileSystemSkillsCatalog()` from `@mitii/host`.

## Must not

- Import V8 `actions/` or `internal/`
- Import `vscode` or webview protocols
- Own intent classification, retrieval, prompting, tools, or verification algorithms

## Development (monorepo)

```bash
pnpm --filter @mitii/sdk typecheck
pnpm --filter @mitii/sdk test
pnpm --filter @mitii/sdk build
```

## Links

- Repo: [Mitii-dev/Mitii](https://github.com/Mitii-dev/Mitii)
- Runtime: [`@mitii/v8`](https://github.com/Mitii-dev/Mitii/tree/main/packages/v8)
- Host kit: [`@mitii/host`](https://github.com/Mitii-dev/Mitii/tree/main/packages/host)
