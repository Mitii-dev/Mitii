# Deterministic check reference

| Check | Purpose |
|---|---|
| `agent_exit` | Agent process returned the expected exit code |
| `output_not_empty` | Agent returned a non-empty answer |
| `output_contains` | Answer includes exact evidence |
| `output_contains_any` | Answer includes at least one accepted alternative |
| `output_not_contains` | Answer does not expose or claim forbidden content |
| `output_regex` | Answer matches a stable pattern |
| `jsonl_event` | Agent emitted a required structured event |
| `json_path_truthy` | JSON/JSONL output includes a required value |
| `file_exists` / `file_not_exists` | Required file state |
| `file_contains` / `file_not_contains` | Exact repository mutation or preservation |
| `dir_has_files` | Directory contains a minimum number of files |
| `workspace_unchanged` / `workspace_changed` | Mode and scope enforcement |
| `file_unchanged` / `file_changed` | Exact file or directory-scope enforcement |
| `command` | Real build, test, lint, type-check, or `__bench__/grade.mjs` script |
| `http` | Starts the project and verifies an actual HTTP response |
| `skills_installed` | Project skill installation count |

## Frontend grading

For feature/bugfix cases prefer:

```json
{
  "type": "command",
  "command": "node __bench__/grade.mjs --json \"[{\\\"op\\\":\\\"contains\\\",\\\"path\\\":\\\"src/App.tsx\\\",\\\"value\\\":\\\"Secondary\\\"}]\"",
  "timeoutMs": 30000
}
```

Supported grader ops: `exists`, `notExists`, `contains`, `notContains`, `matches`.

Do not rely on `file_contains` alone as proof that a feature works — pair it with grade and/or `npm test` / `npm run build`.

## Command check

```json
{
  "type": "command",
  "command": "npm test",
  "timeoutMs": 120000
}
```

The command runs inside the isolated case workspace after the agent finishes.

## Per-case reporting

Every finished case immediately writes:

- `reports/runs/<runId>/cases/<id>.json`
- `reports/runs/<runId>/cases/<id>.md`

and refreshes `reports/runs/<runId>/summary.md` (live progress). A final copy is also written to `--output` / `<suite>-latest.json`.

## HTTP check

```json
{
  "type": "http",
  "start": {
    "command": "node src/index.js"
  },
  "request": {
    "method": "POST",
    "path": "/api/users",
    "json": {
      "name": "Ada"
    }
  },
  "expect": {
    "status": 201,
    "jsonSubset": {
      "name": "Ada"
    },
    "jsonPaths": [
      "id"
    ]
  },
  "timeoutMs": 20000
}
```

The runner allocates a free port and sets `PORT` for the server process.
