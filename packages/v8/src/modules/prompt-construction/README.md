# Prompt Construction

```text
Input:  PromptConstructionInput { decision, userMessage, conversation, repositoryContext?, instructions?, tools?, capabilities }
Output: PromptConstructionResult { request, budget, provenance, omissions }
```

Owns the complete model context budget and serializes a validated `ModelRequest`.
Does not retrieve repository content or invoke models.

## Public API

| Export | Role |
|--------|------|
| `PromptConstructionPipeline` | Public facade (`construct`) |
| `promptConstructionInputSchema` / `PromptConstructionInput` | Boundary input |
| `promptConstructionResultSchema` / `PromptConstructionResult` | Boundary result |
| `CharacterTokenEstimator` | Default token estimator when Engine does not inject one |
| `estimateTurnOutputHeadroom` | Soft preflight helper for mutation payload vs max output |

```ts
const pipeline = new PromptConstructionPipeline();
const result = pipeline.construct({
  schemaVersion: 1,
  decision,
  userMessage: envelope.message,
  conversation: [],
  repositoryContext: {
    stateToken: context.stateToken,
    blocks: context.assembly.blocks.map(/* assembly → prompt slice */),
  },
  tools: grantedToolDefinitions,
  capabilities: llm.capabilities,
});
```

## Flow

```text
PromptConstructionInput
  → validate contracts
  → allocate budget (output reserved first)
  → build system + trusted instructions
  → serialize tools (capability + grant aware)
  → compact conversation by policy
  → wrap repository blocks as untrusted evidence
  → assemble ModelRequest + budget/provenance/omission report
```

## Token strategy

- **Output first:** `AllocateBudget` reserves output tokens before filling
  input sections (`outputReserveRatio`, min floor, capped by provider
  `maximumOutputTokens` and the model context window).
- **Conversation compaction:** Older tool results shrink to
  `compactedToolResultCharacters`; only the most recent
  `compactedToolResultKeepRecent` tool messages stay full. Oldest turns drop
  when still over budget.
- **Headroom helper:** `estimateTurnOutputHeadroom` compares estimated patch
  payload characters against ~70% of max output so Agent Engine can recover
  from truncated multi-file edits.

## Policy highlights

- Output capacity is reserved before optional sections are filled.
- Every included block has provenance and a trust level.
- Repository and tool content are wrapped as `trust="untrusted_data"` evidence.
- Omitted/truncated content is reported by section with stable reasons.
- Skills and memory are accepted as budgeted instruction slots; Engine selects them via the `skills` and `memory` modules.

## Do not put here

- Hybrid retrieval or index access (`repository-context`)
- Model invocation (`model-gateway`)
- Tool execution (`tool-runtime`)
- Skill/memory selection policy (`skills` / `memory`)
- Agent run loop (`agent-engine`)
- Mutation batch *authority* (`decision-policy` mutationBudget)

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/prompt-construction
```
