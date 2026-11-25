# Request Understanding

Converts a normalized `UserRequestEnvelope` into structured intent and
task evidence for Decision Policy and planning. Does not grant authority.

## Contract

**In:** `RequestUnderstandingPipelineInput` (`UserRequestEnvelope`).  
**Out:** `RequestUnderstandingResult` (`intent`, `taskAnalysis`, `evidence`).

| Facade | Stages |
|---|---|
| `understand` | 1-extract → 2-evidence → 3-classify → 4-analyze-task → 5-finalize |

Ports (injected via router deps): `RuleIntentClassifierPort`,
`LlmIntentClassifierPort` (default adapters), optional `ModuleLoggerPort`.
Requires an `LlmPort` for the Officer classifier.

## Example

```ts
import { RequestUnderstandingPipeline } from "@mitii/v8/modules/request-understanding";

const pipeline = new RequestUnderstandingPipeline(llmPort);
const result = await pipeline.understand(envelope);
```

## Non-responsibilities

Grants/routing (decision-policy), planning execution, repository indexing.
Intent helpers live under `helpers/intent/`; task dimensions under
`helpers/task-analyzer/`; mode/turn policies under `rules/`.
