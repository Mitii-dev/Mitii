# Frontend App Fixture

This repository is the Mitii **frontend-app** benchmark fixture.

## Product

Mitii Frontend Benchmark is a small Vite + React + TypeScript starter used to evaluate coding agents on frontend tasks (setup, UI components, auth screens, data fetching, accessibility, responsive layouts, and testing).

## Scripts

- `npm run dev` — start Vite
- `npm run build` — typecheck + production build
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — Vitest
- `npm run lint` — ESLint (may be a placeholder until configured)

## Conventions

- Prefer TypeScript (`.ts` / `.tsx`)
- Keep components under `src/components/`
- Pages/routes under `src/pages/` or router config
- Do not commit secrets; use `.env.example` for public config keys
