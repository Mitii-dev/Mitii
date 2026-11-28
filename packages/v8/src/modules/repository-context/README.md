# Repository Context

The research assistant: it finds the most relevant code for a question and packages it as prompt-safe blocks.

## Does
- Resolves the pinned repository state.
- Retrieves candidates with hybrid search, selects the best under a breadth / budget, and assembles context blocks.
- Reports status, warnings, and statistics.

## Contract
Works on a contract: validated input in → pipeline/steps → validated output out. Reason codes explain outcomes.

**Input:** `RepositoryContextPipelineInput` (`state` reference, `query`, `mode`, filters, `breadth`, `references`, `selectionBudget`).
**Output:** `RepositoryContextPipelineResult` (`status` complete | partial | …, `retrieval`, `selection`, `assembly`, `warnings`, `statistics`).
**Pipeline:** `RepositoryContextPipeline` stages: `1-resolve-state` → `2-prepare-retrieval` → `3-retrieve` → `4-select` → `5-assemble` → `6-finalize-result`
**Ports we offer / need:** needs `RepositoryContextStateResolverPort`, `RepositoryContextRetrieverPort`, `RepositoryContextSelectorPort`, `RepositoryContextAssemblerPort`; optional `ModuleLoggerPort`. Adapters fulfill them (`HybridRetrievalFactory`, `ContextSelector`, `ContextAssemblyFactory`).

## Dependencies
**Upstream (this module uses):** repository-state, request-intake, window-budget.
**Downstream (who uses this):** prompt-construction and the engine (start enrichment, context focus, composition).

## How to use
```ts
import {
  RepositoryContextPipeline, HybridRetrievalFactory, ContextSelector, ContextAssemblyFactory,
} from "@mitii/v8/modules/repository-context";

const pipeline = new RepositoryContextPipeline({
  stateResolver,
  retriever: HybridRetrievalFactory.create(options),
  selector: new ContextSelector(),
  assembler: ContextAssemblyFactory.create(options),
});
const result = await pipeline.execute(input);
```

## Example
Input (illustrative, abbreviated):
```json
{ "state": { "stateToken": "st_123" }, "query": "where is login validated?", "mode": "agent", "maximumResults": 20 }
```
Output (illustrative, abbreviated):
```json
{ "status": "complete", "selection": { "selected": 6 }, "assembly": { "blocks": ["…"] }, "warnings": [] }
```

## Non-responsibilities
Does not index or publish repository state (repository-state), build prompts (prompt-construction), or run tools.
