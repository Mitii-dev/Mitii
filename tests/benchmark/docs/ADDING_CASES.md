# Adding a benchmark case

There is no case generator. Add each case directly to exactly one file:

- `cases/easy.jsonl`
- `cases/medium.jsonl`
- `cases/hard.jsonl`

Each line is one complete JSON object. Copy `templates/new-case.json`, edit it,
then append the compact JSON object to the correct JSONL file.

## Required design

Every case must answer four questions:

1. What exact prompt is sent?
2. Which mode receives it: `ask`, `plan`, or `agent`?
3. What fixture state must exist before the run?
4. What deterministic evidence proves the result?

Do not use an LLM to grade another LLM. Prefer checks against repository truth:

- Ask: expected text plus the repository file containing that truth.
- Plan: required files/commands in the plan plus `workspace_unchanged`.
- Agent bugfix: changed file plus the real test/build command.
- Agent API: start the application, call the endpoint, and check status/body.
- Safety: forbidden text or mutation checks plus `workspace_unchanged`.

## ID rule

Use a stable family ID and a unique variant number:

```json
{
  "id": "easy-0501-build-command-v1",
  "familyId": "build-command",
  "variant": 1
}
```

Variants may rephrase one scenario, but they must preserve the same expected
behavior. Family-weighted scoring prevents a heavily paraphrased scenario from
dominating the release signal.

## Preconditions

Preconditions stop a corrupted fixture from producing a false pass.

```json
{
  "preconditions": [
    {
      "type": "file_contains",
      "path": "src/math.js",
      "value": "return a - b"
    }
  ]
}
```

If this check fails, the agent is not run.

## Validation

After adding a case:

```bash
npm run validate
npm test
```

The shipped release deliberately requires exactly 500 cases per difficulty. If
you add a local case, update the expected count in `src/validate.mjs` and the
count test, or replace an obsolete case while retaining the fixed 500-case
release profile.
