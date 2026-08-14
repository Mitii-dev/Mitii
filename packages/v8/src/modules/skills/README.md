# Skills

Skills selects relevant instruction blocks from a skill catalog. It helps the model follow task-specific playbooks without letting skills grant tools, scan the repository, or override policy.

## What This Module Does

- Loads skill metadata from a catalog.
- Matches skills against query, route, mode, and slim task evidence.
- Applies keyword/similarity scoring.
- Resolves conflict groups.
- Hydrates selected skill bodies.
- Enforces a dedicated token budget.
- Returns prompt-ready instruction blocks with provenance.

## Structure

```text
skills/
  pipeline/                 SkillsPipeline
  actions/                  Match, conflict resolution, budgeting
  adapters/                 InMemorySkillsCatalog
  contracts/
    input/                  SkillsSelectInput
    output/                 SkillDescriptor, SkillsSelectResult
    ports/                  SkillsCatalogPort, SkillSimilarityPort
    errors/                 SkillsErrors
  tests/
```

## Types And Contracts

- `SkillsSelectInput`: query, mode, route, task evidence, budget, and max skill count.
- `SkillTaskEvidence`: primary intent, secondary intents, scope, complexity, risk, recommendations, paths, tags, languages, and project kinds.
- `SkillDescriptor`: skill metadata plus body.
- `SkillInstructionBlock`: prompt-ready instruction content with provenance.
- `SkillsSelectResult`: status, instructions, omissions, token usage, warnings, reason codes, and duration.

## Technical Details

- The public facade method is `SkillsPipeline.select`.
- `InMemorySkillsCatalog` is useful for tests or simple hosts.
- `KeywordSkillSimilarity` is the default similarity implementation.
- Skills can provide resource references/scripts as metadata, but selection does not execute them.
- Repository paths/languages only gate or boost; Skills never scans files.

## Ownership Boundaries

Owns skill selection, scoring, conflict handling, budgeting, omissions, and instruction block output.

Does not own skill execution, policy grants, prompt section budgeting, repository retrieval, or model calls.

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/skills
```

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
I am in a React app. In src/LoginForm.tsx, when the user clicks the "Sign in" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.
```

### Real Input Structure

SkillsSelectInput -> SkillsSelectResult:

```json
{
  "prompt": "I am in a React app. In src/LoginForm.tsx, when the user clicks the \"Sign in\" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.",
  "workspaceId": "workspace-1",
  "stateToken": "state-abc",
  "targetFile": "src/LoginForm.tsx"
}
```

### Step-By-Step Flow

1. A user sends the real prompt shown above from an editor or chat host.
2. The host attaches workspace id `workspace-1` and the explicit target file `src/LoginForm.tsx`.
3. The module receives the real structure shown in the input block.
4. The module validates schema/version/limits before doing any work.
5. The module extracts the important target: `src/LoginForm.tsx`.
6. The module keeps the user constraint: existing validation and error handling must stay intact.
7. The module performs only its own responsibility and does not cross into neighboring modules.
8. Any budget, path, state, or provider constraint is applied before output is produced.
9. The module records warnings/reason codes instead of hiding degraded behavior.
10. The module returns the realistic output shape shown below.
11. The next pipeline stage consumes that output without reinterpreting raw user text.

### Realistic Output

Skills selection result returns a result like this:

```json
{
  "schemaVersion": 1,
  "status": "selected",
  "instructions": [
    {
      "id": "react-form-state",
      "title": "React form pending state",
      "content": "Prefer existing component patterns. Disable submit controls while async submit is pending. Keep validation paths intact.",
      "priority": 80,
      "provenance": { "skillId": "react-form-state", "source": "skills", "score": 0.91 }
    }
  ],
  "omissions": [],
  "usedTokens": 72,
  "budgetTokens": 1200,
  "warnings": [],
  "reasonCodes": ["skills_selected"],
  "durationMs": 8
}
```
