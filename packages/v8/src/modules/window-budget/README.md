# Window Budget

**Does:** turns a model context window size `W` into a `WindowPolicy` number sheet (context pie + work hints). Does not run the agent loop.

## Contract

```text
WindowBudgetInput  →  WindowBudgetPipeline.derive()  →  WindowPolicy
```

| Field group | Meaning |
|---|---|
| Context pie (`usableInputTokens`, `sections.*`, …) | How to fill the prompt |
| Work hints (`run.max*` / `run.hardMax*`, mutation, planning) | Suggested caps for the loop owner |

## Example

```ts
const policy = new WindowBudgetPipeline().derive({
  schemaVersion: 1,
  contextWindowTokens: 100_000,
  effort: "medium",
  mode: "agent",
});

// usable input ≈ W − output reserve − tool-schema cost
// policy.sections.* split that pie across repo / conversation / plan / …
// policy.run.maxModelCalls = soft hint; policy.run.hardMaxModelCalls = hard hint
```
