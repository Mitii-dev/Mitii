# @mitii/sdk

Run Mitii headless ask, plan, and agent sessions from Node 20+.

```bash
npm install @mitii/sdk
```

```ts
import { query } from '@mitii/sdk';

for await (const event of query({
  cwd: process.cwd(),
  prompt: 'Find the test command for this repo',
  mode: 'agent',
  runtime: 'real',
  provider: 'openai-compatible',
  baseUrl: 'http://localhost:11434/v1',
  model: 'qwen3-coder:30b',
  approval: 'auto',
  allowNetwork: false,
})) {
  if (event.type === 'assistant_delta') process.stdout.write(event.content);
  if (event.type === 'tool_start') console.error('tool:', event.tool);
}
```

## Event Contract

`query()` returns an async iterable of NDJSON-friendly events:

- `session_start`: session id, mode, and workspace.
- `assistant_delta`: streamed assistant text.
- `reasoning_delta`: streamed reasoning text when the provider returns it.
- `tool_start` / `tool_end`: sanitized tool activity with path/command previews.
- `approval_required` / `approval_resolved`: manual approval lifecycle.
- `plan`: plan object for Plan mode or plan creation events.
- `metrics`: duration, tool count, session log path, and audit tool names.
- `error`: normalized runtime error.
- `done`: terminal content event.
- `log`: additional sanitized session log events.

Tool inputs and outputs are previews only. Session log sanitization redacts API-key-like values before SDK events are emitted.
