# Adding a benchmark case

Frontend cases are organized by **capability** (agent-only core):

```text
suites/frontend/cases/{feature,bugfix,docs,retrieval,testing}.jsonl
```

Other domains still use difficulty files:

```text
suites/<backend|cicd|testing>/cases/{easy,medium,hard}.jsonl
```

Each line is one complete JSON object. Copy `templates/new-case.json`, edit it,
then append to the correct file. **One variant per family** (`variant: 1` only).

## Required design

Every case must answer four questions:

1. What exact prompt is sent?
2. Which mode receives it? (Frontend core is `agent` only for now.)
3. What fixture state must exist before the run?
4. What deterministic evidence proves the result?

Do not use an LLM to grade another LLM.

Prefer:

- `command` → `node __bench__/grade.mjs --json '...'` for feature/bugfix
- `command` → `npm test` / `npm run build` as supporting proof
- `file_contains` alone only for docs / exact copy tasks
- `output_contains` + `workspace_unchanged` for retrieval

## ID / suite rule

```json
{
  "id": "fe-feature-021-responsive-navbar-v1",
  "familyId": "fe-feature-responsive-navbar",
  "variant": 1,
  "suite": "frontend",
  "difficulty": "medium",
  "capability": "feature",
  "category": "ui-components"
}
```

`suite` must match the domain folder.

## Validation

```bash
npm run validate -- --suite frontend
npm run validate -- --suite all
npm test
```

Expected counts are defined per domain in `suites/<domain>/suite.json`.

To regenerate the frontend core from the writer script:

```bash
node scripts/write-frontend-core.mjs
```
