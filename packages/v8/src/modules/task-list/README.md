# Task List

The run's small checklist: short, ordered, and only one item active at a time.

## Does
- Validates replace / patch / clear updates to the live checklist.
- Creates a temporary discovery list.
- Derives a list from a plan and refills it as the plan moves.
- Serializes the list to markdown for prompts.
- Enforces limits (default 8 items, cap 12; at most one active; empty replace rejected).

## Contract
Works on a contract: validated input in → pipeline/steps → validated output out. Reason codes explain outcomes.

**Input:** `TaskListApplyInput` (source + operation), or a `PlanArtifact` (optionally with the current `TaskList`).
**Output:** `TaskListApplyResult` (status, resulting list, reason codes such as `task_list_replaced`).
**Pipeline:** `TaskListPipeline` stages: `1-apply-update` | `2-create-discovery` | `3-derive-from-plan` | `4-refill-from-plan` (each facade method runs one of these)
**Ports we offer / need:** none of its own; optional `ModuleLoggerPort`. No adapters are required.

## Dependencies
**Upstream (this module uses):** planning (`PlanArtifact` type).
**Downstream (who uses this):** the engine (`update_todos` handling, mutate-readiness, continue/stall logic).

## How to use
```ts
import { TaskListPipeline } from "@mitii/v8/modules/task-list";

const pipeline = new TaskListPipeline();
const applied = pipeline.apply(input);
const derived = pipeline.deriveFromPlan(plan);
```

## Example
Input:
```json
{
  "schemaVersion": 1,
  "source": "agent",
  "operation": {
    "type": "replace",
    "items": [
      { "id": "inspect-login", "title": "Inspect src/LoginForm.tsx", "status": "active" },
      { "id": "add-loading", "title": "Add pending button state", "status": "pending" }
    ]
  }
}
```
Output (illustrative, abbreviated):
```json
{ "status": "applied", "reasonCodes": ["task_list_replaced"] }
```

## Non-responsibilities
Does not plan, run tools, verify work, or persist host UI state.
