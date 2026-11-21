# Settings

- `SettingsPanel.tsx` — public entry (`useSettingsPanelModel` + `SettingsView`).
- `tabs/` — one file per settings tab (profiles, features, workspaces, storage, context, debug) plus the footer.
- `features/` — sub-tabs of the Features tab (autocomplete, review, agent, search, index).
- `profiles/` — provider profile gallery / create wizard / editor and `useProfileSettingsModel`.
- Shared primitives: `fields.tsx`, `pageCopy.ts`, `policyCatalog.ts`, `nomicEmbed.ts`.
- Settings DTOs and persistence stay in `shared/settings.ts` and the engine.
