# Prompt Construction

Builds the provider-neutral `ModelRequest` sent through Model Gateway:
policy, user message, conversation, repository context, skills, memory,
optional plan, and tools under a strict token budget.

## Contract

**In:** `PromptConstructionInput` (decision, message, conversation,
capabilities, optional context/instructions/tools/fragments).  
**Out:** `PromptConstructionResult` (`ModelRequest`, budget report,
provenance, omissions, reason codes).

| Facade | Stages |
|---|---|
| `construct` | 1-allocate → 2-system → 3-tools → 4-conversation/repo → 5-user → 6-dynamic-output |

Ports (injected): optional `TokenEstimatorPort`, `ModuleLoggerPort`.
Default estimator: `CharacterTokenEstimator` (adapters).

## Example

```ts
import { PromptConstructionPipeline } from "@mitii/v8/modules/prompt-construction";

const result = new PromptConstructionPipeline().construct(input);
```

## Non-responsibilities

Model HTTP calls, tool execution, window-band derivation (delegates to
window-budget), repository indexing, and skill/memory retrieval. Fragment
assembly lives under `helpers/fragments/`.
