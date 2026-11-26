# Decision Policy

The referee: it reads the evidence about a request and decides what the agent is allowed to do.

## Does
- Scans the request for prompt-injection signals and clamps authority when found.
- Chooses the route and planning depth.
- Compiles the tool grant, intersected with host safety limits.
- Sets verification requirements and approval needs.
- Records the decision with reason codes and a trace; `narrow` / `widen` adjust a grant afterward.

## Contract
Works on a contract: validated input in → pipeline/steps → validated output out. Reason codes explain outcomes.

**Input:** `DecisionPolicyInput` (request envelope, understanding result, optional repository state, approval / plan modes, host capabilities, `windowPolicy`).
**Output:** `ExecutionDecision` (route, planning, tool grant, verification, approvals, reason codes, trace). Invalid input throws `DecisionPolicyError`.
**Pipeline:** `DecisionPolicyPipeline` stages: `1-scan-injection` → `2-plan-route` → `3-compile-grant` → `4-clamp-injection` → `5-intersect-safety` → `6-resolve-context` → `7-finalize-decision`
**Ports we offer / need:** none of its own; optional `ModuleLoggerPort`. No adapters are required.

## Dependencies
**Upstream (this module uses):** request-intake, request-understanding, repository-state, window-budget (types and policy inputs).
**Downstream (who uses this):** planning, prompt-construction, skills, verification, and the engine / tool-runtime (grant validation on every tool call).

## How to use
```ts
import { DecisionPolicyPipeline } from "@mitii/v8/modules/decision-policy";

const decision = new DecisionPolicyPipeline().decide(input);
```

## Example
Input (illustrative, abbreviated):
```json
{
  "envelope": { "mode": "agent", "message": "Fix the null crash in LoginForm" },
  "understanding": { "intent": { "status": "accepted" } },
  "windowPolicy": { "usableInputTokens": 68000 }
}
```
Output (illustrative, abbreviated):
```json
{ "route": "diagnose", "grant": { "allowedTools": ["read_file", "edit_file"] }, "verification": { "required": true }, "reasonCodes": ["…"] }
```

## Non-responsibilities
Does not run tools or plans, index the repository, build prompts, or classify intent (request-understanding does that).
