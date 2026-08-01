# Memory

```text
Input:  MemoryRetrieveInput { query, scope, budgetTokens?, maxFacts? }
        MemoryCommitInput   { content, scope, tags?, privacy?, expiresAt? }
Output: MemoryRetrieveResult { status, instructions[], omissions[], reasonCodes }
        MemoryCommitResult   { status, memoryId?, expiresAt?, reasonCodes }
```

Retrieves only materially relevant scoped facts with provenance, privacy, and
retention checks. Commit applies retention policy before persisting via the
store port.

Does not own run orchestration or general prompt construction.

## Public API

| Export | Role |
|--------|------|
| `MemoryPipeline` | Public facade (`retrieve`, `commit`) |
| `memoryRetrieveInputSchema` / `MemoryRetrieveInput` | Retrieve boundary |
| `memoryCommitInputSchema` / `MemoryCommitInput` | Commit boundary |
| `memoryRetrieveResultSchema` / `MemoryRetrieveResult` | Selected facts as instructions |
| `InMemoryMemoryStore` | Test/single-process store |

```ts
const memory = new MemoryPipeline({
  store: new InMemoryMemoryStore([
    {
      id: "m1",
      content: "Prefer pnpm in this workspace.",
      scope: { kind: "workspace", workspaceId: "ws" },
      tags: ["pnpm", "package"],
      privacy: "shareable",
      createdAt: new Date().toISOString(),
      source: "user",
    },
  ]),
});

const result = await memory.retrieve({
  schemaVersion: 1,
  query: "install packages with pnpm",
  scope: { kind: "workspace", workspaceId: "ws" },
});
```

## Stages

1. Validate input
2. Query store by scope
3. Filter stale / privacy / scope mismatches
4. Score relevance against the query
5. Apply dedicated token budget
6. (Commit) enforce retention then persist

## Do not put here

- Skill selection (`skills`)
- Prompt budgeting across all sections (`prompt-construction`)
- Run sequencing (`agent-engine`)
- Host UI for memory management

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/memory
```

Includes contract/unit coverage and the labeled evaluation gate in
`tests/evaluation/MemoryEvaluation.spec.ts` (recall ≥90%, irrelevant
rate <10%, stale accepted = 0, budget never exceeded).
