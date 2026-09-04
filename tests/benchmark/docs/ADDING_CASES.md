# Adding a benchmark case

Every suite is organized by **category** — the JSONL file name is the
category, not the difficulty. `difficulty` (easy/medium/hard) is just a
field on each case object and is mixed freely within a file.

```text
suites/frontend/cases/{feature,bugfix,docs,retrieval,testing,capstone}.jsonl
suites/backend/cases/{nest,saas-api,express,monorepo,robustness,auth}.jsonl
suites/testing/cases/{express,monorepo,react}.jsonl
suites/cicd/cases/{react,nest,express,monorepo}.jsonl
```

**Before adding a case, find the right file with the test case
browser** (`pnpm cases` from `tests/benchmark`, or `pnpm cases:open`) —
it lists every case with its suite, source file, difficulty,
capability, and fixture, filterable and searchable, so you can see at
a glance which file a new React case, a new Nest case, a new auth case,
etc. belongs in, and skim what's already covered before adding more.
Most categories map to one fixture family (`nest.jsonl` → `nest-api`,
`express.jsonl` → `node-express`/`legacy-commonjs`/`broken-repo`); a few
(`robustness`, `auth`, `capstone`) are cross-cutting themes that span
multiple fixtures on purpose — pick whichever fixture fits the specific
case, that file is still the right home for it.

See `BACKEND_TESTING_CICD_SUITES.md` for the full per-file breakdown,
fixtures used, and a couple of environment quirks worth knowing about
before adding more cases against `node-express`, `legacy-commonjs`,
`broken-repo`, `nest-api`, or `saas-api`.

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
npm run cases          # regenerate the read-only test case browser after adding cases
```

Expected counts are defined per domain in `suites/<domain>/suite.json` —
update `expectedCounts` (per-difficulty and `total`) whenever you add or
remove cases, or `validate`/`npm test` will fail.

To regenerate the frontend core from the writer script:

```bash
node scripts/write-frontend-core.mjs
```
