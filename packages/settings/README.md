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
| Catalog + manifest properties | `catalogToContributesProperties`, `diffContributesProperties` (`missing` / `extra` / `changed`) |

A catalog `default` of `null` means "unset": it is kept in nested defaults and omitted from the VS Code manifest.

## Exports

Everything comes from the package root: contracts (`settingsCatalogSchema`, `SettingsCatalogEntry`, `parseSettingsCatalog`), catalog (`SETTINGS_CATALOG`, `catalogEntriesForPrefix`), defaults (`DEFAULT_MITII_SETTINGS`, `MitiiSettings`, `buildDefaultSettings`), Desktop profile (`DEFAULT_DESKTOP_SETTINGS`, `DesktopSettings`, `DESKTOP_DEFAULT_OVERRIDES`), nesting (`nestFlatSettings`, `getNestedSetting`, `setNestedSetting`, `flattenNestedSettings`), and VS Code projection helpers.

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
