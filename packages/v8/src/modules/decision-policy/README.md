# Decision Policy

Authority module: converts request evidence into one `ExecutionDecision`
(route, planning, tool grant, verification, approvals). Does not execute
tools or plans.

## Contract

**In:** `DecisionPolicyInput` (envelope, understanding, optional repo state,
approval/plan modes, host capabilities, windowPolicy).  
**Out:** `ExecutionDecision` (route, grant, verification, reason codes, trace).

| Facade | Stages |
|---|---|
| `decide` | 1-scan → 2-route → 3-grant → 4-clamp → 5-safety → 6-context → 7-finalize |
| `narrow` / `widen` | grant adjustment helpers (post-decide) |

Optional `ModuleLoggerPort` via `new DecisionPolicyPipeline({ log })`.

## Example

```ts
import { DecisionPolicyPipeline } from "@mitii/v8/modules/decision-policy";

const decision = new DecisionPolicyPipeline().decide(input);
```

## Non-responsibilities

Tool runtime, repository indexing, prompt construction, and Officer
classification (request-understanding). Route/grant algorithms live under
`helpers/`; thresholds under `rules/`.
