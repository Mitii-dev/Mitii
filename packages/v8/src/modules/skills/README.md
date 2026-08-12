# Skills

```text
Input:  SkillsSelectInput { query, mode, route, evidence, budgetTokens?, maxSkills? }
Output: SkillsSelectResult { status, instructions[], omissions[], usedTokens, reasonCodes }
```

Selects applicable skill instructions from a host-supplied catalog using task
evidence, route, path, and keyword signals. The catalog is progressive:

- `SkillIndexEntry` is cheap L1 metadata used for matching and conflict checks.
- `SkillBody` is lazy L2 content loaded only for selected L1 entries.
- `resources` is an L3 manifest; reading or running it remains Tool Runtime /
  Decision Policy authority, never Skills authority.

Optional `recommendedSkillTags`, `languages`, and `projectKinds` are soft boosts
only — never sole authority. Applies a dedicated budget to hydrated skill bodies
before Prompt Construction.

Does not own general prompt construction, retrieval, or run orchestration.

## Public API

| Export | Role |
|--------|------|
| `SkillsPipeline` | Public facade (`select`) |
| `skillsSelectInputSchema` / `SkillsSelectInput` | Boundary input |
| `skillsSelectResultSchema` / `SkillsSelectResult` | Selected instructions + provenance |
| `skillIndexEntrySchema` / `SkillIndexEntry` | L1 catalog entry shape |
| `skillBodySchema` / `SkillBody` | L2 hydrated body shape |
| `skillDescriptorSchema` / `SkillDescriptor` | Back-compatible full catalog entry shape |
| `InMemorySkillsCatalog` | Test/single-process catalog |

```ts
const skills = new SkillsPipeline({
  catalog: new InMemorySkillsCatalog([
    {
      id: "bugfix-localize",
      title: "Localize bug fixes",
      content: "Prefer the smallest change that fixes the failure.",
      intents: ["bugfix"],
      routes: ["execute", "diagnose"],
      priority: 120,
    },
  ]),
});

const result = await skills.select({
  schemaVersion: 1,
  query: "Fix the null check in parse.ts",
  mode: "agent",
  route: "execute",
  evidence: { primaryIntent: "bugfix", secondaryIntents: [] },
});
```

## Stages

1. Validate input
2. Load catalog
3. Match by intent / route / keywords
4. Resolve conflict groups
5. Hydrate selected skill bodies
6. Apply dedicated token budget

## Do not put here

- Prompt budgeting across all sections (`prompt-construction`)
- Memory retrieval (`memory`)
- Run sequencing (`agent-engine`)
- Marketplace/plugin installation (host concern)

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/skills
```

Includes contract/unit coverage and the labeled evaluation gate in
`tests/evaluation/SkillsEvaluation.spec.ts` (recall ≥90%, irrelevant
instruction rate <10%, budget never exceeded).
