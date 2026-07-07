# monorepo fixture

Three-package pnpm workspace used to exercise cross-package reasoning:

- `packages/shared` — exports `validateEmail` and a `Logger` class used by both other packages.
- `packages/api` — small Express-style handler that imports `validateEmail` from `@mono/shared`.
- `packages/web` — a React component that imports `validateEmail` from `@mono/shared`.

Corner cases this fixture is meant to exercise: renaming/refactoring something in `shared` and
finding every consumer across package boundaries; scoping a change to a single package when
asked; resolving `workspace:*` dependencies correctly.
