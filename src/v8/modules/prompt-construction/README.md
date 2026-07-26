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

## Policy highlights

- Output capacity is reserved before optional sections are filled.
- Every included block has provenance and a trust level.
- Repository and tool content are wrapped as `trust="untrusted_data"` evidence.
- Omitted/truncated content is reported by section with stable reasons.
- Skills and memory are accepted as budgeted instruction slots; selection remains deferred.

## Do not put here

- Hybrid retrieval or index access (`repository-context`)
- Model invocation (`model-gateway`)
- Tool execution (`tool-runtime`)
- Skill/memory selection policy (deferred modules)
- Agent run loop (`agent-engine`)

## Tests

```bash
pnpm exec vitest run src/v8/modules/prompt-construction
```
