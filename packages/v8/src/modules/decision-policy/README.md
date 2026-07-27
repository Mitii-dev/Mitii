# Decision Policy

```text
Input:  DecisionPolicyInput { envelope, understanding, repositoryState? }
Output: ExecutionDecision { route, planningDepth, toolGrant, verification, … }
```

Turns Request Understanding evidence into one authoritative execution decision.
This module authorizes route, planning depth, tool grants, approval mode,
mutation batch budgets, and verification requirements. It does not execute
tools or call models.

## Public API

| Export | Role |
|--------|------|
| `DecisionPolicyPipeline` | Public facade (`decide`) |
| `decisionPolicyInputSchema` / `DecisionPolicyInput` | Boundary input |
| `executionDecisionSchema` / `ExecutionDecision` | Boundary result |
| `toolGrantSchema` / `ToolGrant` | Structured authority grant |
| `mutationBudgetSchema` / `MutationBudget` | Per-call apply_patch batch limits on write grants |

```ts
const pipeline = new DecisionPolicyPipeline();
const decision = pipeline.decide({
  schemaVersion: 1,
  envelope,
  understanding,
  repositoryState: { reference, readiness: "ready" },
});
```

## Flow

```text
DecisionPolicyInput
  → validate contracts
  → scan prompt-injection (annotate only; never broaden grant)
  → resolve route + run disposition
  → resolve planning depth
  → build tool grant (+ resolveMutationBudget on write)
  → resolve verification + repository-context need
  → ExecutionDecision
```

## Mutation budget

Write grants carry an optional `toolGrant.mutationBudget` chosen from profiles
in `policy.ts` (`relaxed` / `standard` / `tight`):

| Profile | When | Effect |
|---------|------|--------|
| `relaxed` | Simple, single-location | Larger batch caps (still hard-capped) |
| `standard` | Default execute | Balanced batch size |
| `tight` | Large file span, complex multi-file, or recommendsPlanning | Small batches; `requireBatchedExecution` |

Tool Runtime enforces `maxPatchesPerCall`, `maxUniqueFilesPerCall`, and
`maxPatchPayloadCharacters`. Agent Engine uses `preferredBatchSize` in
prompt instructions and truncation recovery.

## Policy highlights

- Simple localized tasks get `planningDepth: "none"` (no visible plan).
- Diagnosis-only and ask/plan modes never receive write effects.
- Clarification is `runDisposition: "clarification_required"` (suspended, not failed).
- The model cannot broaden `toolGrant`; injection attempts are ignored.
- Injection clamping strips `mutationBudget` when write authority is removed.

## Do not put here

- Intent classification or task analysis (`request-understanding`)
- Tool execution (`tool-runtime`)
- Prompt construction or model calls
- Agent run state machine (`agent-engine`)

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/decision-policy
```
