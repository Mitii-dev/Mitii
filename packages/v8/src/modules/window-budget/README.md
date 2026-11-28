# Window Budget

The "budget sheet" for a run: given how big the model's context window is, it says how many tokens each part of the prompt and the run may use.

## Does
- Turns a context-window size into a `WindowPolicy` (prompt-section split plus run/mutation/planning caps).
- Adjusts the numbers for effort level and mode.
- Resolves output-token ceilings for generation and tool-loop turns.
- Never runs the agent loop itself.

## Contract
Works on a contract: validated input in → pipeline/steps → validated output out. Reason codes explain outcomes.

**Input:** `WindowBudgetInput` (`contextWindowTokens`, `effort`, `mode`, …).
**Output:** `WindowPolicy` (usable input tokens, `sections.*`, `run.*` soft/hard caps, mutation and planning hints). Bad input throws `invalid_input`.
**Pipeline:** `WindowBudgetPipeline` stages: `1-resolve-policy` → `2-derive-allocation` → (on demand) `3-resolve-generation-ceiling`
**Ports we offer / need:** none of its own; optional `ModuleLoggerPort`. No adapters are required.

## Dependencies
**Upstream (this module uses):** none.
**Downstream (who uses this):** decision-policy, prompt-construction, repository-context, request-understanding, and the engine (run caps, mutation/planning budgets).

## How to use
```ts
import { WindowBudgetPipeline } from "@mitii/v8/modules/window-budget";

const policy = new WindowBudgetPipeline().derive({
  schemaVersion: 1,
  contextWindowTokens: 100_000,
  effort: "medium",
  mode: "agent",
});
```

## Example
Input:
```json
{ "schemaVersion": 1, "contextWindowTokens": 100000, "effort": "medium", "mode": "agent" }
```
Output (abbreviated, illustrative numbers):
```json
{
  "usableInputTokens": 68000,
  "sections": { "repository": 20000, "conversation": 15000, "plan": 4000 },
  "run": { "maxModelCalls": 24, "hardMaxModelCalls": 48 }
}
```

## Non-responsibilities
Does not call models, count real tokens, build prompts, or enforce the caps — the engine and prompt-construction apply the numbers it publishes.
