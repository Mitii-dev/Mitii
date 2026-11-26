# Soft loop rails

Non-suspending mid-turn nudges (§10 soft rails). Hard suspend/complete stays in
`helpers/gates/`.

## Owns
- Tool-loop thrash guard (soft → force final → reject)
- Truncation / reasoning-abort recovery decisions + output truncation recovery plan
- Loop file-read tracker + exploration re-read thrash
- Mutate readiness / evidence gate / mutate-lock tool narrowing
- Mutation critic (evaluate + run) + mutation nudge messages

## Does not own
- Hard gates / checkpoints / suspend kinds
- Progressive tool filtering (engine actions shim)

## Engine
`engine/v8-engine/modules/{tool-loop-guard,truncation,mutate-readiness,mutation-critic,mutation-nudge}`
and `actions/{isExplorationRereadHeavy,evaluateMutationCritic}` re-export this folder.
