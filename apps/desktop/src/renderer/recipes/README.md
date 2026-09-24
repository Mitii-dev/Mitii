# Recipes (desktop)

Host writing recipes (commit message, PR summary, …).

| Layer | Location |
|---|---|
| UI | `RecipesManager.tsx` |
| Engine | `@mitii/host` recipe APIs via `/v1/recipes*` |

Logic stays in `@mitii/host` — desktop only lists/runs/saves.
