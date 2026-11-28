# Loop turn

Disposition of a model loop turn: complete, recover incomplete narration,
recover unfulfilled execute, or continue tools.

## Owns
- Assistant-turn detectors + recovered content compaction
- Incomplete-answer recovery / user-facing answer selection
- `resolveLoopTurnOutcome` + unfulfilled-execute helpers
- Clear mutation-blocker detection

## Does not own
- Soft loop-rails (tool-loop-guard / mutate-readiness) — `helpers/loop-rails`
- Output truncation recovery plans
- Pipeline finish / settle orchestration
