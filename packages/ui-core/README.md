# @mitii/ui-core

Pure TypeScript helpers shared by Mitii Desktop and the VS Code extension (extension host and webview). No React, no Node APIs, no host or engine imports.

## Responsibility

Own UI-facing logic that must behave identically in every shell:

- **Token budget** — `deriveLiveTokenBudgetPreview`, policy merge/pin helpers, `TokenBudgetPreview`, slider-safe values, context-window draft resolution.
- **Window budget** — default numbers, band overlays, and `windowAllocationSlices` for allocation charts.
- **Model pricing** — models.dev rate lookup, session cost estimate, USD formatting, catalog cache.
- **Thoroughness** — Low/Medium/High presets mapped to exploration depth and effort, intensity normalization.
- **Mentions** — `detectMentionSuggest` / `stripTrailingMention` for composer `@` tokens.
- **File links** — `looksLikeWorkspaceFileRef`, `parseFileRef`, `inlineCodeAsFileRef`.
- **Excalidraw** — `parseExcalidrawDocument` and `elementsToSvg`.

## Input / output

Plain values in, plain values out. Network access is limited to `fetchModelsDevCatalog` (global `fetch`, injectable).

## Exports

Everything is exported from the package root (`@mitii/ui-core`). There are no deep imports.

## Failure modes

Helpers return `null`, `undefined`, or clamped defaults for malformed input; they do not throw on bad user data. Pricing lookups return `null` when rates are unknown so UIs can hide the cost chip.

## Non-responsibilities

- React components, hooks, CSS, or VS Code / Electron APIs.
- Session logs, model I/O logs, diagnostics, or other filesystem work (owned by `@mitii/host`).
- Engine window-budget derivation (owned by `@mitii/v8`); this package mirrors only the preview shape used by settings UIs.

## Scripts

```bash
pnpm --filter @mitii/ui-core build
pnpm --filter @mitii/ui-core test
```
