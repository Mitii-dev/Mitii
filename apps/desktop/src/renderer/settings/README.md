# Settings

- `SettingsPanel.tsx` — public entry (`useSettingsPanelModel` + `SettingsView`).
- `tabs/` — one file per settings tab (profiles, features, workspaces, storage, context, debug) plus the footer.
- `features/` — sub-tabs of the Features tab (autocomplete, review, agent, search, index).
- `profiles/` — provider profile gallery / create wizard / editor and `useProfileSettingsModel`.
- Shared primitives: `fields.tsx`, `pageCopy.ts`, `policyCatalog.ts`, `nomicEmbed.ts`.
- Settings DTOs and persistence stay in `shared/settings.ts` and the engine.
- `policyCatalog.ts` wraps `projectNumberFields` from `@mitii/settings` to build tokenBudget / loopPolicy / v8LoopPolicy editor descriptors. Labels, groups, steps, tiers, and Debug-hidden keys come from the shared `TOKEN_BUDGET_PRESENTATION` / `LOOP_POLICY_PRESENTATION` / `V8_LOOP_POLICY_PRESENTATION` maps (same as VS Code); `defaults` come from the `@mitii/ui-core` baselines (`DEFAULT_WINDOW_BUDGET_NUMBERS`, `DEFAULT_LOOP_POLICY_NUMBERS`, `DEFAULT_V8_LOOP_POLICY_NUMBERS`). `policyBaselineNumbers` exposes the same baseline for the loop editors' "Standard" hints. The Debug tab renders a V8 engine section for `v8LoopPolicy`; when enabled, the engine start path (`engine/startOptions.ts` -> `chat/startInput.ts`) forwards its numeric overrides like `loopPolicy`.
