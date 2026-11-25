# Skills

**Does:** select relevant instruction blocks from a skill catalog (match → conflict → hydrate → budget). Does not grant tools, scan the repo, execute skill scripts, or own prompt section budgets.

## Contract

```text
SkillsSelectInput + SkillsCatalogPort
  → SkillsPipeline.select()
  → SkillsSelectResult (instructions, omissions, reasonCodes, usedTokens)
```

| Input signal | Effect |
|---|---|
| `requiredSkillIds` | must include when present in catalog |
| `preferredSkillIds` | soft boost / prefer |
| `evidence` / query / route / mode | matching + scoring |
| `budgetTokens` / `maxSkills` | packing cap |

## Example

```ts
const result = await new SkillsPipeline({
  catalog: new InMemorySkillsCatalog([...]),
}).select({
  schemaVersion: 1,
  query: "Fix null crash in LoginForm",
  mode: "agent",
  route: "diagnose",
  budgetTokens: 2_000,
  evidence: {
    primaryIntent: "bugfix",
    complexity: "moderate",
  },
});

// result.status === "selected" | "empty"
// result.instructions[].content — prompt-ready playbook snippets
// result.reasonCodes may include "skills_selected", "budget_omitted_skills", …
```
