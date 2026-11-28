# Thresholds

Agent-engine and loop-policy threshold resolution (base → window band → lab
overrides) plus reasoning / code-intel nudge budgets.

## Owns
- `resolveAgentEngineThresholds` / overrides schema
- `resolveLoopPolicyThresholds`
- `resolveReasoningAndCodeIntelNudges`

## Does not own
- Threshold constant tables (→ engine legacy policy / loop bands)
- Soft/hard run budget clamp (→ `helpers/budgets`)
