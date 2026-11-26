# Memory

The notebook of durable facts: it recalls what matters for this task and saves new facts safely.

## Does
- Retrieves facts scoped to user / workspace / project, filtered for privacy and scope.
- Ranks them by relevance (BM25, file targets, optional vector similarity) and packs them into a token budget.
- Commits new facts (can supersede an older one) and consolidates stores atomically.
- Treats recalled facts as prompt evidence, never as system instructions.

## Contract
Works on a contract: validated input in → pipeline/steps → validated output out. Reason codes explain outcomes.

**Input:** `MemoryRetrieveInput` (`query`, `scope`, `budgetTokens`, `maxFacts`, `fileTargets`, …), `MemoryCommitInput`, or `MemoryConsolidateInput`.
**Output:** `MemoryRetrieveResult` (`status` retrieved | empty, `instructions`, `omissions`, `reasonCodes`, `usedTokens`), `MemoryCommitResult`, or `MemoryConsolidateResult`.
**Pipeline:** `MemoryPipeline` stages: `1-filter-candidates` → `2-score-relevance` → `3-apply-budget` (retrieve); `4-prepare-commit` → `5-commit-and-consolidate` (commit / consolidate)
**Ports we offer / need:** needs `MemoryStorePort` (`query`, `commit`, optional `list` / `recordAccess`); optional `MemoryEmbeddingPort`, `MemoryIdGeneratorPort`, and `ModuleLoggerPort`. Adapters fulfill them (`InMemoryMemoryStore`, `HashMemoryEmbedding`).

## Dependencies
**Upstream (this module uses):** none.
**Downstream (who uses this):** prompt-construction, and the engine (retrieval during enrichment, memory-graph tool, composition).

## How to use
```ts
import { MemoryPipeline, InMemoryMemoryStore } from "@mitii/v8/modules/memory";

const memory = new MemoryPipeline({ store: new InMemoryMemoryStore(seedFacts) });
const result = await memory.retrieve(input);
```

## Example
Input:
```json
{
  "schemaVersion": 2,
  "query": "Prefer shared Button for form actions",
  "scope": { "kind": "workspace", "workspaceId": "ws-1" },
  "budgetTokens": 600,
  "maxFacts": 5,
  "fileTargets": ["src/LoginForm.tsx"]
}
```
Output (illustrative, abbreviated):
```json
{ "status": "retrieved", "instructions": [{ "content": "…" }], "reasonCodes": ["memory_retrieved"] }
```

## Non-responsibilities
Does not own run orchestration, prompt section budgets, or automatic capture policy.
