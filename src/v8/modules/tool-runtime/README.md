# Tool Runtime

```text
Input:  ToolInvocationInput { toolName, arguments, grant, workspaceRoot, … }
Output: ToolResult { status, output?, reasonCode?, audit, … }
```

Enforced execution boundary for authorized tool calls. Decision Policy issues
the grant; this module validates schema + grant and performs the side effect
through injected ports. Model text cannot increase authority.

## Public API

| Export | Role |
|--------|------|
| `ToolRuntimePipeline` | Public facade (`execute`, `listCapabilities`, `createBudget`) |
| `ToolRegistry` / `createBuiltinToolRegistry` | Register tools without editing the pipeline |
| `toolInvocationInputSchema` / `ToolInvocationInput` | Boundary input |
| `toolResultSchema` / `ToolResult` | Boundary result |
| Port adapters | `NodeWorkspaceFileSystemAdapter`, `NodeProcessAdapter`, in-memory test doubles |

```ts
const runtime = new ToolRuntimePipeline({
  fileSystem: new NodeWorkspaceFileSystemAdapter(),
  process: new NodeProcessAdapter(),
});

const result = await runtime.execute({
  schemaVersion: 1,
  callId: "call_1",
  toolName: "read_file",
  arguments: { path: "src/util.ts" },
  grant: decision.toolGrant,
  workspaceRoot: "/abs/workspace",
});
```

## Adding a tool

Do **not** edit `ToolRuntimePipeline`. Register instead:

1. Add `actions/handlers/<name>Tool.ts` with `{ definition, execute }`
2. Append it to `BUILTIN_TOOLS` in `actions/handlers/index.ts`

Or inject a custom registry at construction time:

```ts
const registry = createBuiltinToolRegistry().register({
  definition: defineTool({ name: "my_tool", /* … */ }),
  execute: async (ctx) => ({ output: {}, truncated: false, redacted: false }),
});

const runtime = new ToolRuntimePipeline(ports, { registry });
```

## Phase 4 tools

- `list_directory`
- `read_file`
- `search_files`
- `read_diagnostics`
- `read_git_status`
- `run_readonly_command` (argv only; no shell)

`fetch_url` is catalogued for capability negotiation and network-grant tests
but is not executable in this phase.

## Flow

```text
ToolInvocationInput
  → parseInvocation
  → preflightToolCall (budget, registry, grant, args)
  → registered.execute(handler)
  → buildFinishedResult | mapExecutionError
  → ToolResult + audit event
```

Pipeline sources:

| File | Owns |
|------|------|
| `pipeline/ToolRuntimePipeline.ts` | Orchestration only |
| `pipeline/parseInvocation.ts` | Input contract parse |
| `pipeline/preflightToolCall.ts` | Budget / grant / schema gates |
| `pipeline/buildToolResult.ts` | Rejected, finished, and error results |

## Do not put here

- Route / planning / approval policy (`decision-policy`)
- Model invocation (`model-gateway`)
- Prompt construction
- Agent run state machine (`agent-engine`)
- Mutation transactions (Phase 8)

## Tests

```bash
pnpm exec vitest run src/v8/modules/tool-runtime
```
