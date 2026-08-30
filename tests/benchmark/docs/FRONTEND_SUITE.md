# Frontend domain

Agent-only confidence core (85 cases: a 70-case generated core, 11
hand-authored extension cases, and 4 full-app capstone cases). Ask/plan
come later.

```text
suites/frontend/cases/
  feature.jsonl     # 27 (20 core + 5 hooks/theme/a11y/seo + 2 Next.js middleware/server-action)
  bugfix.jsonl      # 23 (20 core + 3 extension)
  docs.jsonl        # 10
  retrieval.jsonl   # 10
  testing.jsonl     # 11 (10 core + 1 extension)
  capstone.jsonl    # 4  (welcome website, tic-tac-toe, sudoku, chess move validator)
```

| Capability | Count | Difficulty | Primary oracle |
|---|---:|---|---|
| feature | 27 | medium | `__bench__/grade.mjs` + build/typecheck |
| bugfix | 23 | hard | seeded fixture bugs + grade + build |
| docs | 10 | easy | file content + lint |
| retrieval | 10 | easy | output assertions + workspace unchanged |
| testing | 11 | hard | agent-authored Vitest + `npm test` |
| capstone | 4 | hard | pristine oracle test suite (or content checks) + full build |

## Extension cases

Eleven cases were hand-appended on top of the generated core:
custom hooks (`useDebounce`, `useFetch`), `localStorage` theme
persistence, dynamic Open Graph metadata (Next.js `generateMetadata`),
an ARIA live-region component, a `useEffect` interval-leak bugfix, an
async stale-response race-condition bugfix, a modal focus-trap/keyboard
bugfix, a missing-unit-test-coverage case, Next.js Middleware
(route-guard redirect), and a Next.js Server Action (form submit).
They live in the same `feature.jsonl` / `bugfix.jsonl` / `testing.jsonl`
files, IDed `fe-feature-02x-*`, `fe-bugfix-02x-*`, `fe-testing-011-*`.
See the CAUTION note atop `scripts/write-frontend-core.mjs` —
regenerating the core does not regenerate these.

## Capstone: full applications from a near-blank scaffold

Unlike every other case in this benchmark, `capstone.jsonl` doesn't ask
the agent to modify an existing app — it asks for a **complete small
application** built from a near-blank Vite+React+TS+Vitest+RTL scaffold:
a welcome/portfolio website, a playable Tic-Tac-Toe game, an interactive
Sudoku validator, and a chess piece-movement validator (movement/capture
rules only — no check/checkmate/castling/en passant/promotion). Each of
the three logic-heavy ones is graded by a **pristine, not-yet-passing
oracle test file already committed in the fixture** (e.g.
`src/tictactoe.test.ts` calling a `checkWinner` function the agent must
implement) plus a full production build; the website is graded by
`grade.mjs` content checks plus build. See
`BACKEND_TESTING_CICD_SUITES.md` for why each of these three uses its
own dedicated fixture copy (`app-scaffold-tictactoe` /
`-sudoku` / `-chess`) instead of sharing one.

## Fixtures

- `next-app` — App Router routes, metadata, loading, a dynamic
  `app/posts/[slug]` route, and Middleware/Server-Action extension cases
- `react-vite` — components, utils, CSS
- `frontend-app` — Vitest + React Testing Library-ready React app for
  testing cases, plus `src/hooks/`, `src/utils/format.ts`, a
  `SignupForm` with submit states, and seeded-bug components
  (`LiveClock`, `SearchBox`, `Modal`) used by the extension cases
- `app-scaffold*` — near-blank capstone starters (see above)

Each fixture ships `__bench__/grade.mjs` for deterministic filesystem checks.

## Commands

```bash
pnpm benchmark:frontend
pnpm --filter @mitii/solid-benchmark validate -- --suite frontend
node scripts/write-frontend-core.mjs   # regenerates the 70-case core only — see CAUTION in the script
pnpm --filter @mitii/solid-benchmark cases  # read-only test case browser (filter by suite/file/difficulty)
```

See `npm run suites` for live counts.
