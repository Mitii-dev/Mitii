# @mitii/ui-react

Props-only React components shared by Mitii Desktop and the VS Code webview. Each component takes data and callbacks and renders markup with documented class names; hosts supply styling (shared `--mitii-*` tokens come from `@mitii/ui-theme`).

## Responsibility

Own UI that must look and behave the same in every shell:

| Component | Purpose |
|---|---|
| `PendingPlanBanner` | Strip shown when a plan awaits hand-off to Agent mode. |
| `MemoryPanel` | Workspace memory list with a compose box. |
| `CheckpointPanel` | Checkpoint list with restore / review / delete / clear. |
| `ModelQuickSelect` | Model picker with filter, custom model id, and profile shortcut. |
| `TokenBudgetAllocation` | Context-window allocation bar and legend. |
| `TokenMeter` | Token chip + popover: cost, cache, latest call, window budget tree. Split under `token-meter/`. |
| `TokenBudgetEditor` | Allocation chart, Simple sliders, optional Advanced policy fields; includes `NumberField` and `SliderField`. |

Helpers: `emptyTokenUsage`, `addTurnTokens`, `cacheHitRatio`, `formatCompact`, `formatPct`, `formatDuration`.

## Input / output

Props in, callbacks out. Domain math (budget previews, pricing, policy merge) comes from `@mitii/ui-core`; this package never fetches, never reads host globals, and never imports a host. `react` is a peer dependency.

Hosts tune presentation with explicit props instead of forks: `className` (panel chrome), `placement` / `glyph` / `reportedLabel` / `liveStatsLayout` (`TokenMeter`), `triggerIcon` / `checkIcon` / `showCaret` / `custom` (`ModelQuickSelect`), `hintMode` / `renderFieldHelp` (`TokenBudgetEditor`).

## Class-name contract

Components emit stable class names (`btn`, `btn-primary`, `btn-ghost`, `token-chip*`, `token-popover*`, `slider-field*`, `model-quick-select*`, …). Each host stylesheet must define them from `--mitii-*` tokens. Ghost buttons use `btn btn-ghost`; the VS Code stylesheet treats `.btn.ghost` and `.btn.btn-ghost` the same.

## Exports

Everything is exported from the package root (`@mitii/ui-react`). No deep imports.

## Failure modes

Components render safe empty states for missing data (no breakdown, no cost rates, empty lists) and clamp numeric input. Invalid numbers in `NumberField` revert to the last committed value on blur.

## Non-responsibilities

- No host messaging, Electron/VS Code APIs, or engine calls.
- No CSS files (tokens live in `@mitii/ui-theme`; component rules stay in each app's stylesheet until the Wave 1.4 stylesheet split).
- Not yet shared: Desktop/VS Code `ComposerControls` (different option sets and icons), Markdown body, review bar, and per-field help with docs links (`TokenBudgetFieldHelp` stays in VS Code and plugs in through `renderFieldHelp`).

## Settings catalog

The `mitii.*` settings catalog lives in `@mitii/settings` (`SETTINGS_CATALOG`, nested `DEFAULT_MITII_SETTINGS`, `catalogEntriesForPrefix`). Desktop reads it through `apps/desktop/src/shared/settings.ts`; `node packages/settings/scripts/check-vscode-contributes.mjs` keeps `apps/vscode/package.json` in sync with it. The VS Code webview still hardcodes its fields. Budget settings already route through `@mitii/ui-core` (`deriveLiveTokenBudgetPreview`, `mergeLiveWindowBudgetPolicy`, pin helpers) in both hosts via `TokenBudgetEditor`. Next step: render catalog entries through `NumberField` / `SliderField`.

## Scripts

```bash
pnpm --filter @mitii/ui-react build
pnpm --filter @mitii/ui-react test
```
