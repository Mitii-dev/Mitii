# Task List

Task List owns the compact live checklist for a run. It validates task-list updates, derives concrete lists from plans, and serializes/deserializes markdown checkbox lists for hosts and prompts.

## What This Module Does

- Applies `replace`, `patch`, and `clear` operations.
- Enforces max item count, unique ids, and at most one active item.
- Derives a compact checklist from concrete plan steps.
- Parses and serializes markdown task lists.
- Provides prompt-safe task-list guidance and progress helpers.

## Structure

```text
task-list/
  pipeline/                 TaskListPipeline
  actions/                  Apply, derive, serialize, parse
  contracts/
    input/                  TaskListApplyInput
    output/                 TaskList, TaskListApplyResult
    errors/                 TaskListErrors
  tests/
```

## Types And Contracts

- `TaskListApplyInput`: current list, source, and operation.
- `TaskListOperation`: `replace`, `patch`, or `clear`.
- `TaskList`: schema version, source (`plan` | `agent` | `user` | `discovery`), optional purpose (`discovery` | `execution`), optional title, and items.
- Discovery lists are temporary UI progress. Execution lists are derived from `PlanArtifact` and must stay file-scoped.
- `TaskItem`: id, title, status, optional detail, optional plan `sourceRef`.
- `TaskItemStatus`: `pending`, `active`, `done`, `skipped`, or `blocked`.
- `TaskListApplyResult`: applied/rejected status, optional task list, warnings, and reason codes.

## Technical Details

- Lists are capped at eight items by default.
- Empty replacement lists are rejected.
- Patch operations require existing ids.
- Derivation prefers concrete file-scoped implementation/verification steps over process-only discovery rows and stamps `purpose: "execution"`.
- `createDiscoveryList` builds a temporary investigating checklist. Engine replaces it when the final plan arrives. Do not persist a discovery list as the approved execution checklist.
- Agent Engine may auto-advance concrete rows after successful built-in mutations, but this module only applies validated changes.

## Ownership Boundaries

Owns checklist invariants and serialization.

Does not own planning, execution, verification, host persistence, or deciding that a run must have a task list.

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/task-list
```

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
I am in a React app. In src/LoginForm.tsx, when the user clicks the "Sign in" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.
```

### Real Input Structure

TaskListApplyInput -> TaskListApplyResult:

```json
{
  "prompt": "I am in a React app. In src/LoginForm.tsx, when the user clicks the \"Sign in\" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.",
  "workspaceId": "workspace-1",
  "stateToken": "state-abc",
  "targetFile": "src/LoginForm.tsx"
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

Task List apply result returns a result like this:

```json
{
  "schemaVersion": 1,
  "status": "applied",
  "taskList": {
    "schemaVersion": 1,
    "source": "agent",
    "items": [
      { "id": "inspect-login", "title": "Inspect src/LoginForm.tsx", "status": "active" },
      { "id": "add-loading", "title": "Add pending button state", "status": "pending" },
      { "id": "verify-login", "title": "Verify LoginForm behavior", "status": "pending" }
    ]
  },
  "warnings": [],
  "reasonCodes": ["task_list_replaced"]
}
```
