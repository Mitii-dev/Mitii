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

## Read-only tools (Phase 4)

- `list_directory`
- `read_file`
- `search_files`
- `read_diagnostics`
- `read_git_status`
- `run_readonly_command` (argv only; no shell)

`fetch_url` is catalogued for capability negotiation and network-grant tests
but is not executable in this phase.

## Mutation tool (Phase 8)

- `apply_patch` — applies structured `oldText`/`newText` patches inside a
  recoverable transaction.

Mutation calls are grant-gated (`maximumWorkspaceEffect: "write"`,
`workspace_write` effect) and additionally approval-gated when the grant's
`approvalMode` is `"when_required"`:

```text
execute(apply_patch, …)
  → grant/effect/schema preflight
  → dirty-overlap check (options.dirtyPaths vs. patch paths)
  → approval preflight (skipped when approvalMode is "never")
      no/mismatched approval → status "rejected", reasonCode "approval_required",
        output.fingerprint = fingerprintToolCall(toolName, arguments)
      matching approval     → proceed
  → begin MutationTransactionRegistry checkpoint
  → apply patches, capture changedFiles
  → ToolResult.output = { checkpointId, changedFiles }
```

Callers (Agent Engine) re-submit the same call with
`options.approval = { approvalId, fingerprint, decision: "approved" }` to
proceed; the fingerprint must match the one returned on the rejected call.

`ToolRuntimePipeline.rollbackMutation({ checkpointId })` restores exactly the
files touched by that transaction — user edits outside the transaction are
left untouched. `ToolRuntimePipeline.commitMutation(checkpointId)` discards
the recovery snapshot once a caller (e.g. Verification) confirms the change
is durable. `fingerprintToolCall` is exported for callers that need to
compute or compare fingerprints without invoking the tool.

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

- Route / planning / approval *policy* (which routes require approval,
  verification requirements) — that's `decision-policy`
- Model invocation (`model-gateway`)
- Prompt construction
- Agent run state machine, checkpoints, resume (`agent-engine`)
- Verification algorithms (`verification`)

## Tests

```bash
pnpm exec vitest run src/v8/modules/tool-runtime
```
