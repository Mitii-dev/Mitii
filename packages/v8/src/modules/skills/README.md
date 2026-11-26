# Skills

A librarian for playbooks: it picks the few skill instructions that fit this request and fit the budget.

## Does
- Resolves required and preferred skills, and matches others from the request, route, mode, and repository evidence.
- Parses skill mentions and maps understanding/repository evidence into match signals.
- Merges candidates, resolves conflicts, then packs skills under the token budget.
- Formats prompt-ready instruction text.

## Contract
Works on a contract: validated input in → pipeline/steps → validated output out. Reason codes explain outcomes.

**Input:** `SkillsSelectInput` (`query`, `mode`, `route`, `evidence`, `requiredSkillIds`, `preferredSkillIds`, `budgetTokens`, `maxSkills`).
**Output:** `SkillsSelectResult` (`status` selected | empty, `instructions`, `omissions`, `reasonCodes`, `usedTokens`).
**Pipeline:** `SkillsPipeline` stages: `1-resolve-required` → `2-resolve-preferred` → `3-match-skills` → `4-merge-candidates` → `5-resolve-conflicts` → `6-apply-budget` (plus helper steps for mentions, evidence mapping, and prompt formatting)
**Ports we offer / need:** needs `SkillsCatalogPort` (list skills, optionally load bodies); optional `SkillSimilarityPort` and `ModuleLoggerPort`. Adapters fulfill them (`InMemorySkillsCatalog`, `KeywordSkillSimilarity`).

## Dependencies
**Upstream (this module uses):** decision-policy, repository-state, request-intake, request-understanding (types and evidence).
**Downstream (who uses this):** the engine (skill selection during start enrichment); planning receives the selected skills through the engine.

## How to use
```ts
import { SkillsPipeline, InMemorySkillsCatalog } from "@mitii/v8/modules/skills";

const skills = new SkillsPipeline({ catalog: new InMemorySkillsCatalog(entries) });
const result = await skills.select(input);
```

## Example
Input:
```json
{
  "schemaVersion": 1,
  "query": "Fix null crash in LoginForm",
  "mode": "agent",
  "route": "diagnose",
  "budgetTokens": 2000,
  "evidence": { "primaryIntent": "bugfix", "complexity": "moderate" }
}
```
Output (illustrative, abbreviated):
```json
{
  "status": "selected",
  "instructions": [{ "id": "debugging", "content": "…" }],
  "reasonCodes": ["skills_selected"],
  "usedTokens": 640
}
```

## Non-responsibilities
Does not grant tools, scan the repository, run skill scripts, or own prompt section budgets.
