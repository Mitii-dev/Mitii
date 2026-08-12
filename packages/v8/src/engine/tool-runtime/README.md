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
| `validateMutationBatch` | Enforce `grant.mutationBudget` on `apply_patch` |
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

## Read-only tools

- `list_directory`
- `read_file`
- `read_many_files`
- `glob_files`
- `file_metadata`
- `search_files`
- `read_diagnostics`
- `read_git_status`
- `goto_definition`
- `find_references`
- `run_readonly_command` (argv only; no shell; agent grant = toolchain + git read prefixes)
- `read_package_scripts`

## Network tools (grant-gated)

- `fetch_url` — requires `NetworkPort` + non-empty `networkHosts`
- `fetch_docs` — same policy, HTML-stripped body
- `web_search` — requires host-injected `SearchPort` (no hardcoded vendor)

## Mutation tools

- `apply_patch` — default write grant
- `delete_file` — default write grant
- `delete_directory` — default write grant
- `move_file` — default write grant
- `run_command` — opt-in only (explicit grant + commandRules + approval)

Model-facing JSON schemas are generated from registered Tool Runtime
definitions (`listBuiltinModelToolDefinitions`) so Agent Engine prompts cannot
drift from Zod execute schemas.

Verification uses a **separate** grant (`buildVerificationGrant`) that keeps
read-only tools/effects while reusing the same toolchain command prefixes
the agent grant uses for diagnosis.

## Mutation tool (Phase 8)

- `apply_patch` — applies structured `oldText`/`newText` patches inside a
  recoverable transaction.
- `delete_file` / `delete_directory` / `move_file` — filesystem mutations
  inside the same recoverable checkpoint model.

Mutation calls are grant-gated (`maximumWorkspaceEffect: "write"`,
`workspace_write` effect) and additionally approval-gated when the grant's
`approvalMode` is `"when_required"`:

```text
execute(apply_patch|delete_file|delete_directory|move_file, …)
  → grant/effect/schema preflight
  → mutationBudget batch limits (apply_patch only)
  → dirty-overlap check
  → approval preflight (skipped when approvalMode is "never")
      no/mismatched approval → status "rejected", reasonCode "approval_required",
        output.fingerprint = fingerprintToolCall(toolName, arguments)
      matching approval     → proceed
  → begin MutationTransactionRegistry checkpoint
  → apply mutation, capture changedFiles
  → ToolResult.output = { checkpointId, changedFiles, … }
```

### Mutation batch limits

`apply_patch` is capped at the catalog (`max` 12 patches) and further by
`grant.mutationBudget` (or `DEFAULT_FALLBACK_MUTATION_BUDGET`):

- `maxPatchesPerCall`
- `maxUniqueFilesPerCall`
- `maxPatchPayloadCharacters` (sum of oldText + newText)

Oversized batches return `status: "rejected"`, `reasonCode: "limit_exceeded"`.
This keeps each model turn under provider output-token limits on large tasks.

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
  → preflightToolCall (budget, registry, grant, schema, mutation batch, approval)
  → registered.execute(handler)
  → buildFinishedResult | mapExecutionError
  → ToolResult + audit event
```

Pipeline sources:

| File | Owns |
|------|------|
| `pipeline/ToolRuntimePipeline.ts` | Orchestration only |
| `pipeline/helpers/preflightToolCall.ts` | Budget / grant / schema / mutation batch gates |
| `pipeline/helpers/buildToolResult.ts` | Rejected, finished, and error results |
| `actions/ValidateMutationBatch.ts` | apply_patch batch size enforcement |

## Do not put here

- Route / planning / approval *policy* (which routes require approval,
  verification requirements) — that's `decision-policy`
- Model invocation (`model-gateway`)
- Prompt construction
- Agent run state machine, checkpoints, resume (`agent-engine`)
- Verification algorithms (`verification`)

## Tests

```bash
pnpm exec vitest run packages/v8/src/engine/tool-runtime
```
