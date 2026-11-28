# Skills

Execute-start skill selection: preferred ids from task size/route, skills_ready
event payload, and enrichment select flow (skills port + emit callbacks).

## Owns
- `resolvePreferredSkillIdsForRun`
- `buildSkillsReadyEvent`
- `selectSkillsForEnrichment` (ports for skills + emit)

## Does not own
- Skills catalog / pipeline (→ `modules/skills`)
- Engine EventBus / AgentEngineRuntime wiring
