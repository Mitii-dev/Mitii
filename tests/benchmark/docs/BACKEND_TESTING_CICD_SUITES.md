# Backend, testing, and cicd domains

Curated agent-only cores, mirroring the frontend core's design: one
variant per family, one clear prompt, deterministic checks grounded in
real (often pre-existing, real-world-shaped) bugs and gaps in each
fixture — no synthetic paraphrase/robustness variants.

Case files are named by **category** — mostly the tech/framework family
the cases target, so you always know exactly which file to append new
cases to:

```text
suites/backend/cases/
  nest.jsonl         # 7  — plain NestJS app (nest-api): guards, interceptors, pipes, filters
  saas-api.jsonl      # 13 — large synthetic NestJS-shaped SaaS API (retrieval-style; doesn't compile)
  express.jsonl        # 9  — node-express, legacy-commonjs, broken-repo
  monorepo.jsonl        # 4  — pnpm workspace
  robustness.jsonl        # 7  — ambiguous prompts, scope discipline, prompt-injection resistance
  auth.jsonl                # 4  — hand-rolled auth (API keys, bearer tokens, NestJS Guard)

suites/testing/cases/
  express.jsonl       # 15 — node:test coverage for node-express/legacy-commonjs/broken-repo
  monorepo.jsonl        # 6  — node:test coverage for the pnpm workspace
  react.jsonl             # 2  — React Testing Library (renderHook, form submit states)

suites/cicd/cases/
  react.jsonl         # 6  — frontend-app / next-app build & lint config
  nest.jsonl            # 2  — nest-api test-pipeline wiring
  express.jsonl           # 6  — node-express / legacy-commonjs
  monorepo.jsonl             # 4  — workspace-level CI/test orchestration
```

Every file mixes easy/medium/hard by the explicit `difficulty` field —
file name is category, not difficulty. `suites/<domain>/suite.json`'s
`expectedCounts` is the source of truth for totals; update it whenever
you add or remove cases.

These three domains, together with the frontend core's `feature` /
`bugfix` / `testing` / `capstone` capabilities, cover six day-to-day
developer workflows:

| Workflow | Where |
|---|---|
| Feature implementation (API, validation, state, auth) | `backend` (`feature`, `auth.jsonl`), `frontend` (`feature`) |
| Complex bug fixes & edge cases | `backend` (`bugfix`), `frontend` (`bugfix`) |
| Refactoring & code quality | `backend` (`refactor`) |
| Testing & QA | `testing`, `frontend` (`testing`) |
| Accessibility & SEO | `frontend` (`feature`/`bugfix`, category `a11y`/`seo`) |
| Build, config & devops | `cicd` |
| Robustness (ambiguous prompts, prompt-injection resistance) | `backend/cases/robustness.jsonl` |
| Full applications built from a near-blank scaffold | `frontend/cases/capstone.jsonl` |

## Fixtures used

- `nest-api` — small NestJS app; builds and typechecks cleanly, but
  **cannot actually boot an HTTP server** (`@nestjs/platform-express`
  isn't installed). Grade nest-api cases with `npm run build` plus a
  `node -e` script that instantiates the class directly (guard,
  interceptor, pipe, filter) — never an `http` check.
- `node-express` — small Express app; `node --test` runs real tests.
- `legacy-commonjs` — callback-style CommonJS server, a modernization target.
- `broken-repo` — Express app with a missing module and a real off-by-one bug.
- `monorepo` — pnpm workspace (`packages/shared`, `packages/api`, `packages/web`).
- `saas-api` — large synthetic NestJS-shaped SaaS API used for
  retrieval/robustness elsewhere in this repo. It does **not** compile
  (dozens of pre-existing, intentional missing-dependency/missing-method
  errors — see `npx tsc --noEmit` output). Cases here grade it with
  `file_contains`/`file_not_contains` plus a `node -e` content-assertion
  command, never `npm run build`.
- `frontend-app` — also used by `cicd`/`testing`; now ships
  `@testing-library/react` + `jest-dom` + `user-event` (see below).
- `app-scaffold`, `app-scaffold-tictactoe`, `app-scaffold-sudoku`,
  `app-scaffold-chess` — near-blank Vite+React+TS+Vitest+RTL starters
  for the frontend `capstone` cases. Each capstone task other than the
  welcome website gets its **own** fixture copy so its pristine,
  not-yet-implemented oracle test file (`tictactoe.test.ts` /
  `sudoku.test.ts` / `chess.test.ts`) doesn't fail `tsc`/`vitest` runs
  for the other capstone cases sharing the same fixture.

## React Testing Library is available

`frontend-app` and all four `app-scaffold*` fixtures include
`@testing-library/react`, `@testing-library/jest-dom`, and
`@testing-library/user-event` as committed `devDependencies` (installed
once via `fixtures:install`, before any case runs — agents cannot
install new packages mid-case). `src/test-setup.ts` wires
`afterEach(cleanup)` and jest-dom matchers via `vitest.config.ts`'s
`test.setupFiles`. Use this for any new component/form/hook testing
cases instead of the old smoke-test-only pattern.

## A real Node quirk to know about

On some Node versions, `node --test <dir>/` (directory form, no
trailing filename) throws `MODULE_NOT_FOUND` instead of discovering
`*.test.js` files — `node --test <dir>/*.test.js` (glob) or explicit
file paths both work reliably. `node-express`, `legacy-commonjs`,
`broken-repo`, and `monorepo/packages/shared`'s own `test` scripts use
the glob form for this reason. Every case's own `command` checks
target specific test files explicitly for the same reason, and to
avoid one case's intentionally-seeded failing test (e.g. the
pagination off-by-one in `node-express/test/paginate.test.js`, or the
response-ordering bug in `legacy-commonjs/test/list-order.test.js`)
leaking into an unrelated case run against the same fixture.

## No new dependencies at grading time

Fixture `node_modules` are installed once via `fixtures:install`
before a run; agents cannot `npm install` new packages during a case.
`cicd` cases that plausibly want a real linter/formatter/test
framework (ESLint, Prettier, Jest) either ask for a dependency-free
equivalent script, or ask for the target config file content only
(graded structurally, paired with a real `npm run build`/`test` sanity
command) rather than actually executing the un-installed tool. Where a
real tool is genuinely useful for grading (React Testing Library,
Jest-shaped config), it's added as a committed `devDependency` ahead of
time instead — see `frontend-app` above.

## Commands

```bash
pnpm benchmark:backend
pnpm benchmark:testing
pnpm benchmark:cicd
pnpm --filter @mitii/solid-benchmark validate -- --suite backend
pnpm --filter @mitii/solid-benchmark validate -- --suite all
pnpm --filter @mitii/solid-benchmark cases          # read-only test case browser
```
