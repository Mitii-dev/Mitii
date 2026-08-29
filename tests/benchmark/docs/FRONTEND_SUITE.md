# Frontend domain

Agent-only confidence core (70 cases). Ask/plan come later.

```text
suites/frontend/cases/
  feature.jsonl     # 20
  bugfix.jsonl     # 20
  docs.jsonl        # 10
  retrieval.jsonl   # 10
  testing.jsonl     # 10
```

| Capability | Count | Difficulty | Primary oracle |
|---|---:|---|---|
| feature | 20 | medium | `__bench__/grade.mjs` + build/typecheck |
| bugfix | 20 | hard | seeded fixture bugs + grade + build |
| docs | 10 | easy | file content + lint |
| retrieval | 10 | easy | output assertions + workspace unchanged |
| testing | 10 | hard | agent-authored Vitest + `npm test` |

## Fixtures

- `next-app` — App Router routes, metadata, loading
- `react-vite` — components, utils, CSS
- `frontend-app` — Vitest-ready React app for testing cases

Each fixture ships `__bench__/grade.mjs` for deterministic filesystem checks.

## Commands

```bash
pnpm benchmark:frontend
pnpm --filter @mitii/solid-benchmark validate -- --suite frontend
node scripts/write-frontend-core.mjs   # regenerate the 70 cases
```

See `npm run suites` for live counts.
