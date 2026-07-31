# `@mitii/sdk`

Host-neutral programmatic API over [`@mitii/v8`](https://www.npmjs.com/package/@mitii/v8). Apps and tests use this package instead of importing V8 internals.

## Install

```bash
npm install @mitii/sdk
```

Requires **Node.js 20+**. Depends on `@mitii/v8`. License: **AGPL-3.0-or-later**.

> Until this package is published from the current monorepo, consume it from the workspace (`pnpm --filter @mitii/sdk`). Legacy npm `@mitii/sdk@2.7.x` is a different API surface.

## Quick start

```ts
import { createMitiiClient, EchoLlmPort } from '@mitii/sdk';
import type { LlmPort } from '@mitii/v8';

// Hosts inject real provider ports; Echo is for local smoke only.
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
| `client.start(input)` | Validate intake-facing input → Agent Engine run handle |
| `run.events` | Async iterable of V8 `RunEvent` |
| `run.result` | Terminal `AgentRunResult` |
| `run.cancel()` | Cancel in-flight model/tool work |
| `client.resume(input)` | Resume after `clarification_required` / `approval_required` |
| `client.publishRepositoryState(input)` | Optional; calls V8 Repository State facade |

Filesystem checkpoints, skills catalogs, search, and indexing live in **`@mitii/host`** (or your own port implementations). The SDK stays host-neutral.

## Must not

- Import V8 `actions/` or `internal/`
- Import `vscode` or webview protocols
- Own intent classification, retrieval, prompting, tools, or verification algorithms

See [LEGACY_EXPORTS.md](./LEGACY_EXPORTS.md) for pre-rewrite SDK decisions.

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
