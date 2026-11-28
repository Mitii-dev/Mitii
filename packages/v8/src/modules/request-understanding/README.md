# Request Understanding

The interpreter: it reads the clean request and works out what the user wants and how big the task is.

## Does
- Extracts messages and builds an evidence pack from the request and repository signals.
- Prefers assessment ballot (`assessDirection` / `understandViaAssessment`) without RuleIntent dual scores; legacy dual-path `understand()` still available.
- Analyzes the task (size, clarity, targets) and can recommend clarification.
- Never grants authority.

## Contract
Works on a contract: validated input in → pipeline/steps → validated output out. Reason codes explain outcomes.

**Input:** the normalized `UserRequestEnvelope` (as `RequestUnderstandingPipelineInput`).
**Output:** `RequestUnderstandingResult` — `intent` (status accepted | clarification_required, classification, scores), `taskAnalysis`, optional `evidence`.
**Pipeline:** `RequestUnderstandingPipeline` stages: `1-extract-messages` → `2-build-evidence` → `3-classify-intent` → `4-analyze-task` → `5-finalize-result`
**Ports we offer / need:** needs an `LlmPort` (constructor argument) for the Officer; offers `RuleIntentClassifierPort` and `LlmIntentClassifierPort`, fulfilled by default adapters (rule and LLM classifiers) and replaceable through dependencies. Optional `ModuleLoggerPort`.

**S2 path:** prefer `assessDirection` / `understandViaAssessment` (or `understand(..., { useAssessmentBallot: true })`) — SituationPack-shaped ballot with no RuleIntent dual scores. Legacy dual-path `understand()` remains for engine callers until flipped.

## Dependencies
**Upstream (this module uses):** request-intake (envelope), model-gateway (`LlmPort`), repository-state, window-budget.
**Downstream (who uses this):** decision-policy, planning, skills, and the engine (start pipeline, composition).

## How to use
```ts
import { RequestUnderstandingPipeline } from "@mitii/v8/modules/request-understanding";

const understanding = new RequestUnderstandingPipeline(llmPort);
const result = await understanding.understand(envelope);
```

## Example
Input (illustrative, abbreviated):
```json
{ "mode": "agent", "message": "Fix the null crash in src/LoginForm.tsx", "referencedArtifacts": [{ "path": "src/LoginForm.tsx" }] }
```
Output (illustrative, abbreviated):
```json
{ "intent": { "status": "accepted", "classification": { "primaryIntent": "bugfix" } }, "taskAnalysis": { "size": "small" } }
```

## Non-responsibilities
Does not choose routes or grants (decision-policy), run plans, or index the repository.
