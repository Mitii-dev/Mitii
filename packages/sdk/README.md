# @mitii/sdk

Host-neutral programmatic API over `@mitii/v8` Agent Engine. Apps and tests use this package instead of importing V8 internals or legacy controllers.

```bash
pnpm --filter @mitii/sdk build
pnpm --filter @mitii/sdk test
```

```ts
import { createMitiiClient, EchoLlmPort } from '@mitii/sdk';
import type { LlmPort, ModelEvent, ModelRequest } from '@mitii/v8';

// Hosts inject real provider ports; Echo is for local smoke only.
const understandingLlm: LlmPort = /* structured classification LLM */;
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

## Must not

- Import V8 `actions/` or `internal/`
- Import `vscode` or webview protocols
- Own intent classification, retrieval, prompting, tools, or verification algorithms
- Reintroduce `HeadlessAgentHost` / ThunderController

See `LEGACY_EXPORTS.md` for adapt/defer/delete decisions on the pre-Phase-12 SDK.
