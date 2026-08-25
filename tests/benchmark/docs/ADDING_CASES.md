# Adding a benchmark case

Cases are organized by **domain**, then by **difficulty**:

```text
suites/<frontend|backend|cicd|testing>/cases/{easy,medium,hard}.jsonl
```

Each line is one complete JSON object. Copy `templates/new-case.json`, edit it,
then append to the correct domain difficulty file.

## Required design

Every case must answer four questions:

1. What exact prompt is sent?
2. Which mode receives it: `ask`, `plan`, or `agent`?
3. What fixture state must exist before the run?
4. What deterministic evidence proves the result?

Do not use an LLM to grade another LLM.

## ID / suite rule

```json
{
  "id": "fe-021-responsive-navbar-v1",
  "familyId": "fe-responsive-navbar",
  "variant": 1,
  "suite": "frontend",
  "difficulty": "medium",
  "category": "ui-components"
}
```

`suite` must match the domain folder. `difficulty` must match the JSONL file name.

## Validation

```bash
npm run validate -- --suite frontend
npm run validate -- --suite all
npm test
```

Expected counts are defined per domain in `suites/<domain>/suite.json`.
