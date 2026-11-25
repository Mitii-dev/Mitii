# Task List

**Does:** owns the compact live checklist for a run — validate replace/patch/clear, derive/refill from a plan, serialize markdown for prompts. Does not plan, execute tools, verify, or persist host UI state.

## Contract

```text
TaskListApplyInput     →  TaskListPipeline.apply()           →  TaskListApplyResult
PlanArtifact           →  TaskListPipeline.deriveFromPlan()  →  TaskListApplyResult
TaskList + PlanArtifact → TaskListPipeline.refillFromPlan() →  TaskListApplyResult
```

| Rule | Effect |
|---|---|
| Max items | default 8 (cap 12) |
| Active items | at most one |
| Empty replace | rejected |
| Discovery vs execution | discovery is temporary UI; execution must stay file-scoped |

## Example

```ts
const pipeline = new TaskListPipeline();

const applied = pipeline.apply({
  schemaVersion: 1,
  source: "agent",
  operation: {
    type: "replace",
    items: [
      { id: "inspect-login", title: "Inspect src/LoginForm.tsx", status: "active" },
      { id: "add-loading", title: "Add pending button state", status: "pending" },
    ],
  },
});
// applied.status === "applied"
// applied.reasonCodes includes "task_list_replaced"
```
