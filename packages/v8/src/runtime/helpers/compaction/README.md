# Compaction ladder

Window-policy-driven model-loop history compaction (soft stubs → drop turns →
hard compact → reinject pinned facts/memory).

## Owns
- Thresholds / pressure / token estimates
- Tool-history stubs and dropped-turn summaries
- `compactModelLoopMessages` (+ WindowPolicy entry)

## Does not own
- Memory port refresh after compaction (`refreshMemoryFactsForCompaction` stays engine)
- Session `/compact` dispatch (→ `session-control`, injects this ladder)

## Engine
`engine/.../actions/compact*` re-export this folder.
