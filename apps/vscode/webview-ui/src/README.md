# VS Code webview UI

`App.tsx` is the composition root: it chains the hooks below into one flat `AppApi`, subscribes to host
messages, and renders the shell. It contains no state or business logic itself.

## Layout

| Path | Owns |
|---|---|
| `hooks/` | State slices composed in dependency order: `useShellNav` → `useIntensity` → `useIndexStatus` → `useThreads` → `useSettingsState` → `useRunStream` → `useReviewState` → `useSettingsActions` → `useComposer` → `useAutomations`. Each hook receives only the earlier slices it needs (typed via `XApi`), and returns everything it declares. |
| `hooks/useHostMessages.ts` | Single host-message subscription; reads the latest `AppApi` through a ref (no stale closures). |
| `hostMessages/` | Pure per-domain handlers `(msg, api) => handled`: settings, run, workspace, review, composer, plus `applyBootstrap`. |
| `app/` | Pure helpers: UI defaults, snapshot hydration, mode defaults/merge, turn builders, review helpers, `AppApi` type. |
| `containers/` | Panels bound to `AppApi`: `ShellHeader`, `ChatView` (`MessageListContainer`, `ComposerDock` and its code-review row, suggest popover, footer), `SettingsView`, `OnboardingView`. |
| `components/` | Presentational components (props in, callbacks out). `SettingsPanel` is a thin shell over `components/settings/` (one file per tab, footer, new-profile modal, panel state hook). |
| `styles.css` + `styles/` | Entry imports `@mitii/ui-theme` first, then ordered partials `NN-<feature>.css`. Order is cascade order — add a partial at the right position, keep each ≤600 lines. |

## Rules

- Add state to the hook that owns the domain; if a new slice needs another slice, take it as a typed dep and keep the
  hook order acyclic (types only flow forward).
- New host message types go in the matching `hostMessages/*` handler and are covered by
  `tests/hostMessageRouting.test.tsx`.
- Shared contracts come from `@mitii/ui-protocol` / `@mitii/ui-core` / `@mitii/ui-react` (`./protocol` re-exports).

## Failure modes

Handlers never throw into the bridge listener; host errors land in `error` state and render in `ErrorBanner`.
