# Frontend domain

Cases live under:

```text
suites/frontend/cases/{easy,medium,hard}.jsonl
```

Includes:

1. Migrated React/Next cases from the former core suite (`react-vite`, `next-app`)
2. The 100 scenarios from `project-goals/ref/front-end-testcases.md` (`frontend-app` fixture)

Dedicated FE generator cases (`fe-001` … `fe-100`) are split by difficulty roughly as:

| Range | Difficulty | Themes |
|---|---|---|
| 1–10 | easy | project setup |
| 11–70 | medium | auth, components, data, forms, some perf |
| 71–100 | hard | a11y depth, responsive, state, testing quality |

See `npm run suites` for live counts.
