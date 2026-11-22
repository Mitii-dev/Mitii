# Settings

- `SettingsPanel.tsx` — public entry (`useSettingsPanelModel` + `SettingsView`).
- `tabs/` — one file per settings tab (profiles, features, workspaces, storage, context, debug) plus the footer.
- `features/` — sub-tabs of the Features tab (autocomplete, review, agent, search, index).
- `profiles/` — provider profile gallery / create wizard / editor and `useProfileSettingsModel`.
- Shared primitives: `fields.tsx`, `pageCopy.ts`, `policyCatalog.ts`, `nomicEmbed.ts`.
- Settings DTOs and persistence stay in `shared/settings.ts` and the engine.
- `policyCatalog.ts` wraps `projectNumberFields` from `@mitii/settings` to build tokenBudget / loopPolicy / v8LoopPolicy editor descriptors. Desktop supplies only the group, the Simple-key set (mirrors the VS Code presentation overlays; every other key is Advanced), Debug-hidden keys, and the UI-core window-budget baseline as tokenBudget `defaults`. The Debug tab renders a V8 engine section for `v8LoopPolicy` (persisted settings only; the Desktop engine start path does not forward it yet).
