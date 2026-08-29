# Tool Runtime

Tool Runtime is the enforcement and execution layer for tools. It receives model-requested tool calls from Agent Engine, validates them against the current `ToolGrant`, executes through host ports, and returns a bounded `ToolResult` with audit information.

Tool Runtime never decides that a tool should be allowed. It only enforces the grant it receives.

## Responsibilities

- Validate `ToolInvocationInput`.
- Check tool name, effect, path scope, command rules, network hosts, output limits, and mutation batch limits.
- Execute built-in or custom tools through registered definitions.
- Sanitize, redact, and truncate tool output.
- Emit structured audit data for every call.
- Support mutation rollback where the executed tool provides enough information.

## Structure

```text
tool-runtime/
  pipeline/                 ToolRuntimePipeline and execution helpers
  contracts/
    input/                  ToolInvocationInput
    output/                 ToolResult, ToolCapability
    ports/                  Filesystem, process, network, git, diagnostics, search
    errors/                 ToolRuntimeErrors
  actions/                  Grant validation, mutation batch validation, built-ins
  adapters/                 Node and in-memory host adapters
  internal/                 Registry, shadow authorization, sanitization, budgets
  tests/                    Registry, grant, mutation, network, command tests
```

## Main Types

- `ToolInvocationInput`: `callId`, `toolName`, raw `arguments`, exact `grant`, `workspaceRoot`, and optional `pinnedState`.
- `ToolResult`: status, reason code, optional output, truncation/redaction flags, duration, bytes, warnings, and audit event.
- `ToolRuntimePorts`: host capabilities for filesystem, process, network, git, diagnostics, search, and repository graph access.
- `RegisteredTool`: tool definition plus execute function.
- `ToolDefinition`: model-facing name, description, input schema, effects, and output limits.
- `ToolGrant`: authority from Decision Policy that Tool Runtime enforces.

## Technical Details

- `ToolRegistry` stores built-in and custom tool definitions.
- `createBuiltinToolRegistry` wires default V8 tools.
- `defineTool` creates typed custom tool definitions.
- `StructuralShadowGrantAuthorizer` can evaluate a Cedar-shaped structural grant in parallel with normal validation.
- Mutation batches enforce `maxPatchesPerCall`, `maxUniqueFilesPerCall`, and `maxPatchPayloadCharacters`. Exceeding those caps fails preflight with `mutation_budget_exceeded` (not a generic `limit_exceeded`).
- Mutation tools (`apply_patch`, delete, move) authorize against `grant.mutationPathScopes` when present; discovery tools keep `grant.pathScopes`.
- `apply_patch` keeps exact `oldText` matching (no fuzzy match, no regex). Default requires a unique occurrence. Optional `replaceAll: true` replaces every exact occurrence in that file; empty `oldText` still means create or full-file replace and rejects `replaceAll`. Distinct reason codes describe why a hunk failed: `old_text_not_found`, `old_text_ambiguous`, `patch_target_missing`, `patch_hash_mismatch`, `identical_old_and_new`, `patch_syntax_invalid`. Retryable conflicts attach clipped `currentContent` in the tool result. `patch_conflict` remains as a legacy umbrella for older hosts.
- Preflight coerces common model mis-encodings for `apply_patch`: a flat `{ path, oldText, newText }` object is wrapped into `{ patches: [...] }`, and a JSON-string `patches` value is parsed into an array before schema validation.
- Process execution always goes through `ProcessPort`.
- Network access always goes through `NetworkPort` and host allow-lists.
- Output is bounded by the minimum of tool, grant, and session limits.
- `search_files.path` may be a file or a directory. Adapters MUST stat the
  root before `readdir`; a file root returns that single file.
- `search_files` stays line-oriented and returns structured matches. Its
  contract supports `mode: "auto" | "literal" | "regex"` so hosts and models
  can search text generically without depending on a specific CLI search tool.
  Auto mode prefers literal search unless the query shows clear regex intent.

## Ownership Boundaries

Owns tool registration, preflight authorization, execution through ports, output safety, mutation batch limits, rollback support, and audit records.

Does not own route selection, approval UI, prompt construction, model calls, repository indexing, or verification policy.

## Public Exports

`ToolRuntimePipeline`, `ToolRegistry`, `defineTool`, `createBuiltinToolRegistry`, `BUILTIN_TOOLS`, built-in adapters, schemas, contracts, and shadow authorization helpers are exported from `@mitii/v8`.

## Tests

```bash
pnpm exec vitest run packages/v8/src/engine/tool-runtime
```

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
I am in a React app. In src/LoginForm.tsx, when the user clicks the "Sign in" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.
```

### Real Input Structure

ToolInvocationInput -> ToolResult:

```json
{
  "schemaVersion": 1,
  "callId": "call-read-login",
  "toolName": "read_file",
  "arguments": { "path": "src/LoginForm.tsx" },
  "workspaceRoot": "/repo",
  "pinnedState": { "workspaceId": "workspace-1", "stateToken": "state-abc" },
  "grant": "decision.toolGrant"
}
```

### Step-By-Step Flow

1. A user sends the real prompt shown above from an editor or chat host.
2. The host attaches workspace id `workspace-1` and the explicit target file `src/LoginForm.tsx`.
3. The module receives the real structure shown in the input block.
4. The module validates schema/version/limits before doing any work.
5. The module extracts the important target: `src/LoginForm.tsx`.
6. The module keeps the user constraint: existing validation and error handling must stay intact.
7. The module performs only its own responsibility and does not cross into neighboring modules.
8. Any budget, path, state, or provider constraint is applied before output is produced.
9. The module records warnings/reason codes instead of hiding degraded behavior.
10. The module returns the realistic output shape shown below.
11. The next pipeline stage consumes that output without reinterpreting raw user text.

### Realistic Output

Tool Runtime execution returns a result like this:

```json
{
  "schemaVersion": 1,
  "callId": "call-read-login",
  "toolName": "read_file",
  "status": "ok",
  "output": { "path": "src/LoginForm.tsx", "contentPreview": "export function LoginForm() { ... }" },
  "truncated": false,
  "redacted": false,
  "bytesProduced": 4812,
  "warnings": [],
  "audit": {
    "callId": "call-read-login",
    "toolName": "read_file",
    "status": "ok",
    "path": "src/LoginForm.tsx",
    "inputPreview": "{\"path\":\"src/LoginForm.tsx\"}",
    "bytesProduced": 4812,
    "truncated": false,
    "redacted": false
  }
}
```
