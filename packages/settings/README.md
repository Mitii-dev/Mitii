# @mitii/settings

Single source of truth for the `mitii.*` settings catalog shared by Mitii Desktop and the VS Code extension.

## Responsibility

- Own the flat catalog of `mitii.*` settings (`type`, `default`, `description`, `enum`, `minimum`, `maximum`) in `src/data/catalog.json`.
- Validate the catalog at load against a Zod contract (`settingsCatalogSchema`).
- Derive nested defaults (`DEFAULT_MITII_SETTINGS`) and their TypeScript type (`MitiiSettings`) from the catalog — there is no second hand-maintained defaults list.
- Provide flat ↔ nested helpers and a projection to VS Code `contributes.configuration.properties`.
- Ship `scripts/check-vscode-contributes.mjs`, which fails when `apps/vscode/package.json` drifts from the catalog.

## Input / output

| Input | Output |
|---|---|
| `catalog.json` (validated) | `SETTINGS_CATALOG`, `catalogEntriesForPrefix` |
| Catalog defaults | `DEFAULT_MITII_SETTINGS` (nested, host-neutral) |
| Catalog defaults + `DESKTOP_DEFAULT_OVERRIDES` | `DEFAULT_DESKTOP_SETTINGS` / `DesktopSettings` (Desktop compat profile: Ollama provider defaults only; `DesktopSettings` is `MitiiSettings`, and the engine choice lives at `engine.implementation`) |
| Flat `mitii.a.b` keys | Nested `{ a: { b } }` via `nestFlatSettings`; back via `flattenNestedSettings` |
| Catalog prefix + optional presentation overlay (+ optional baseline `defaults`) | `projectNumberFields(prefix, overlay, options)` → validated `NumberFieldDescriptor[]` for number-field editors |
| Catalog + manifest properties | `catalogToContributesProperties`, `diffContributesProperties` (`missing` / `extra` / `changed`) |

### Number-field projection

`projectNumberFields` turns the numeric entries under a prefix (e.g. `tokenBudget`) into UI descriptors (`key`, `group`, `label`, `description`, `kind`, `min`, `max`, `step`, `defaultValue`, `tier`, `docsHref`, `hiddenFromDebug`). The descriptor shape is structurally identical to the UI token-budget descriptor, but this package does not import any UI package.

- The catalog owns keys, `min`/`max`, and `description`. A presentation overlay (keyed by short key) may only add group, label, kind, step, tier, docsHref, hiddenFromDebug; overlay key order sets output order, remaining catalog keys follow.
- `defaultValue` is the catalog default unless `options.defaults` supplies a host ship baseline (e.g. SDK runtime defaults). Baseline drift from the catalog is a host concern and is not rewritten here.
- Kind is inferred (`integer` type → `int`, `maximum <= 1` → `ratio`, else `number`) unless the overlay says otherwise. `enabled` and non-numeric entries are skipped.
- Shared presentation overlays live in `src/presentation/` and are the single source of group, label, kind, step, tier, and `hiddenFromDebug` for `mitii.tokenBudget.*`, `mitii.loopPolicy.*`, and `mitii.v8LoopPolicy.*`. VS Code and Desktop pass them to `projectNumberFields`; each must name only catalog number keys and cover all of them (`tests/presentation.contract.test.ts`).
- Failure reasons (`ProjectNumberFieldsError.reason`): `unknown_overlay_key`, `unknown_default_key`, `invalid_overlay`, `invalid_descriptor`.

### Known default drift (catalog vs host ship baseline)

The catalog `default` is the value written to `package.json` and to Desktop's nested defaults. The VS Code host instead passes the SDK runtime baseline as `options.defaults`, so editor `defaultValue` (shown as "Standard: …") differs from the catalog default for the keys below. The catalog is intentionally **not** rewritten to hide this; each host test pins the exact set (`KNOWN_DEFAULT_DRIFT`) and fails on any new or removed drift. Remove a row only when the catalog default is aligned with the SDK value.

`tokenBudget` (baseline: `DEFAULT_WINDOW_BUDGET_POLICY`; pinned in `apps/vscode/tests/tokenBudgetFieldsFromCatalog.test.ts`):

| Key | Catalog | SDK |
|---|---|---|
| `outputRatio` | 0.1 | 0.2 |
| `outputMinTokens` | 1024 | 10240 |
| `outputWindowCapRatio` | 0.2 | 0.35 |
| `visiblePlanMinUsableTokens` | 40000 | 8192 |
| `changeImpactMinUsableTokens` | 40000 | 8192 |
| `maxSkillsBase` | 1 | 2 |
| `maxSkillsPerUsable` | 30000 | 12000 |

`loopPolicy` (baseline: `AGENT_ENGINE_THRESHOLDS`; pinned in `apps/vscode/tests/loopPolicyFieldsFromCatalog.test.ts`). Window-band thresholds can shift the live value further; these are the static ship baselines:

| Key | Catalog | SDK |
|---|---|---|
| `explorationRereadMinCalls` | 8 | 6 |
| `maxReadOnlyToolTurnsBeforeMutationNudge` | 6 | 4 |
| `maxUnfulfilledExecuteRecoveries` | 1 | 2 |
| `defaultPreferredBatchSize` | 8 | 12 |
| `defaultMaxPatchesPerCall` | 16 | 24 |

`v8LoopPolicy` has no drift (`V8_ENGINE_THRESHOLDS` equals the catalog); it is pinned empty in `apps/vscode/tests/v8LoopPolicyFieldsFromCatalog.test.ts`.

Desktop (renderer) cannot import the SDK. Its descriptors take `defaults` from `@mitii/ui-core` baselines (`DEFAULT_WINDOW_BUDGET_NUMBERS`, `DEFAULT_LOOP_POLICY_NUMBERS`, `DEFAULT_V8_LOOP_POLICY_NUMBERS`), which equal the SDK values above, so `defaultValue` matches VS Code for all three prefixes. The loop/v8 baselines are pinned against `AGENT_ENGINE_THRESHOLDS` / `V8_ENGINE_THRESHOLDS` in the VS Code `*FieldsFromCatalog` tests. Desktop's persisted nested defaults still come from the catalog, so the five `loopPolicy` rows above remain drift between persisted values and the editor's "Standard" hint.

A catalog `default` of `null` means "unset": it is kept in nested defaults and omitted from the VS Code manifest.

## Exports

Everything comes from the package root: contracts (`settingsCatalogSchema`, `SettingsCatalogEntry`, `parseSettingsCatalog`), catalog (`SETTINGS_CATALOG`, `catalogEntriesForPrefix`), defaults (`DEFAULT_MITII_SETTINGS`, `MitiiSettings`, `buildDefaultSettings`), Desktop profile (`DEFAULT_DESKTOP_SETTINGS`, `DesktopSettings`, `DESKTOP_DEFAULT_OVERRIDES`), nesting (`nestFlatSettings`, `getNestedSetting`, `setNestedSetting`, `flattenNestedSettings`), shared presentation overlays (`TOKEN_BUDGET_PRESENTATION`, `LOOP_POLICY_PRESENTATION`, `V8_LOOP_POLICY_PRESENTATION`), number-field projection (`projectNumberFields`, `numberFieldDescriptorSchema`, `NumberFieldDescriptor`, `ProjectNumberFieldsError`), and VS Code projection helpers.

## Adding or changing a setting

1. Edit `src/data/catalog.json`.
2. Run `node packages/settings/scripts/check-vscode-contributes.mjs --write` to patch `apps/vscode/package.json` (adds, updates, and removes `mitii.*` keys; non-catalog fields such as `scope` are preserved).
3. Run `pnpm --filter @mitii/settings test`.

```bash
pnpm --filter @mitii/settings build
pnpm --filter @mitii/settings test
pnpm --filter @mitii/settings typecheck
node packages/settings/scripts/check-vscode-contributes.mjs        # check
node packages/settings/scripts/check-vscode-contributes.mjs --write # patch
```

## Failure modes

- Invalid catalog data (bad key, missing description, default outside `minimum`/`maximum`/`enum`, a key that is both leaf and group) throws a `ZodError` at module load.
- `nestFlatSettings` throws when keys conflict or are empty.
- The check script exits `1` on drift and `2` when the manifest has no `contributes.configuration.properties`.

## Non-responsibilities

- No imports from `@mitii/host`, `@mitii/sdk`, `@mitii/v8`, or any app.
- No per-host merge policy (Desktop `mergeDesktopSettings`, autocomplete lock, engine env mapping stay in the hosts).
- No UI rendering, secrets, or persistence.
- No VS Code manifest fields beyond the catalog-owned ones (`scope`, `enumDescriptions`, `markdownDeprecationMessage`, object `properties`).
