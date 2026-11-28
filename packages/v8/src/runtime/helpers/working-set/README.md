# Working set

Recoverability trailing block (checklist / mutation caps / facts) and sticky
mutable character estimates for compaction.

## Owns
- `serializeRecoverabilityWorkingSet`
- `buildMutationBudgetInstruction` / working-set lines
- `estimateStickyMutableChars`

## Does not own
- Established-fact extraction (→ `helpers/established-facts`)
- Compaction ladder (→ `helpers/compaction`)
