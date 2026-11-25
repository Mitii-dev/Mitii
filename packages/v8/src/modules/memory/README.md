# Memory

**Does:** retrieve and commit durable facts scoped to user / workspace / project. Recalled facts are prompt evidence, not system instructions. Does not own run orchestration, prompt section budgets, or automatic capture policy.

## Contract

```text
MemoryRetrieveInput + MemoryStorePort (+ optional MemoryEmbeddingPort)
  → MemoryPipeline.retrieve()
  → MemoryRetrieveResult (instructions, omissions, reasonCodes, usedTokens)

MemoryCommitInput + store
  → MemoryPipeline.commit()
  → MemoryCommitResult

MemoryConsolidateInput + atomic store
  → MemoryPipeline.consolidate()
  → MemoryConsolidateResult
```

| Signal | Effect |
|---|---|
| `scope` / `requesterUserId` / `origin` | filter privacy + scope |
| `query` / `fileTargets` / `concepts` | BM25 + file + optional vector rank |
| `budgetTokens` / `maxFacts` | pack into prompt budget |
| `replacesId` | supersede an eligible latest fact on commit |

## Example

```ts
const pipeline = new MemoryPipeline({
  store: new InMemoryMemoryStore([...seedFacts]),
});

const result = await pipeline.retrieve({
  schemaVersion: 2,
  query: "Prefer shared Button for form actions",
  scope: { kind: "workspace", workspaceId: "ws-1" },
  budgetTokens: 600,
  maxFacts: 5,
  fileTargets: ["src/LoginForm.tsx"],
});

// result.status === "retrieved" | "empty"
// result.instructions[] — prompt-ready memory blocks
// result.reasonCodes may include "memory_retrieved", "budget_omitted_memory", …
```
