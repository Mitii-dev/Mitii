# Prompt Construction

The packer: it fits policy, request, history, context, skills, memory, plan, and tools into one model request that respects the token budget.

## Does
- Allocates the token budget across prompt sections.
- Assembles the system prompt, tools, conversation, repository context, and the user request.
- Resolves dynamic output headroom for the turn.
- Reports provenance and what was omitted and why.

## Contract
Works on a contract: validated input in → pipeline/steps → validated output out. Reason codes explain outcomes.

**Input:** `PromptConstructionInput` (decision, message, conversation, model capabilities, optional context / instructions / tools / fragments).
**Output:** `PromptConstructionResult` (`ModelRequest`, budget report, provenance, omissions, reason codes).
**Pipeline:** `PromptConstructionPipeline` stages: `1-allocate-budget` → `2-assemble-system` → `3-assemble-tools` → `4-assemble-conversation` → `5-assemble-user-request` → `6-resolve-dynamic-output`
**Ports we offer / need:** optional `TokenEstimatorPort` (default adapter `CharacterTokenEstimator`); optional `ModuleLoggerPort`.

## Dependencies
**Upstream (this module uses):** decision-policy, window-budget, model-gateway, repository-context, memory, mcp-attach.
**Downstream (who uses this):** the engine (start pipeline, planning-input preparation, composition).

## How to use
```ts
import { PromptConstructionPipeline } from "@mitii/v8/modules/prompt-construction";

const result = new PromptConstructionPipeline().construct(input);
// result.request is the ModelRequest to send through model-gateway
```

## Example
Input (illustrative, abbreviated):
```json
{ "decision": { "route": "diagnose" }, "message": "Fix the null crash in LoginForm", "conversation": [], "capabilities": { "contextWindowTokens": 100000 } }
```
Output (illustrative, abbreviated):
```json
{ "request": { "messages": [{ "role": "system", "content": "…" }, { "role": "user", "content": "Fix the null crash in LoginForm" }] }, "omissions": [], "reasonCodes": ["…"] }
```

## Non-responsibilities
Does not call models, run tools, index the repository, or retrieve skills and memory — it only packs what it is given.
