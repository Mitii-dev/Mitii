# @mitii/ui-theme

One `--mitii-*` CSS custom-property contract shared by Mitii Desktop and the VS Code webview, plus one adapter per host. Component CSS reads only `--mitii-*` names; each host decides what they resolve to.

## Responsibility

- Declare the token contract (`MITII_THEME_TOKENS`) and the host-independent values (`css/tokens.css`: brand, accent, base radius).
- Provide adapters that satisfy the full contract:
  - `css/vscode.css` — derives surfaces, text, borders, status colors, and fonts from `--vscode-*` so the UI follows the editor theme.
  - `css/standalone.css` — literal light (default) and dark (`:root[data-theme='dark']`) palettes for Desktop; expects `Inter Variable` and `IBM Plex Mono` to be bundled by the app.
- Keep the contract testable: a contract test fails if an adapter misses a token or declares one outside the list.

## Usage

```css
/* VS Code webview styles.css */
@import '@mitii/ui-theme/vscode.css';

/* Desktop renderer styles.css */
@import '@mitii/ui-theme/standalone.css';
```

Each adapter already imports `tokens.css`; import `@mitii/ui-theme/tokens.css` directly only when writing a new adapter.

## Token contract

| Group | Tokens |
|---|---|
| Brand (shared) | `--mitii-brand`, `--mitii-brand-soft`, `--mitii-brand-on`, `--mitii-accent`, `--mitii-accent-soft`, `--mitii-radius` |
| Brand (adapter) | `--mitii-brand-hover`, `--mitii-brand-tint` |
| Surfaces | `--mitii-surface`, `--mitii-panel`, `--mitii-panel-raised` |
| Lines | `--mitii-border`, `--mitii-border-soft` |
| Text | `--mitii-text`, `--mitii-muted`, `--mitii-chat-fg` |
| Status | `--mitii-danger`, `--mitii-ok`, `--mitii-warn`, `--mitii-warn-soft` |
| Shape | `--mitii-radius-lg`, `--mitii-space-x` |
| Fonts | `--mitii-font-ui`, `--mitii-font-tool`, `--mitii-font-file`, `--mitii-font-thinking`, `--mitii-font-mono` |
| Elevation | `--mitii-shadow-soft`, `--mitii-shadow-tight` |

App-specific aliases (for example Desktop's short `--bg` / `--panel` names) stay in the app stylesheet and must be defined from `--mitii-*` tokens.

## Exports

- `@mitii/ui-theme` — `MITII_THEME_TOKENS`, `MitiiThemeToken`, `MITII_THEME_ENTRY_POINTS`.
- `@mitii/ui-theme/tokens.css`, `/vscode.css`, `/standalone.css`.

## Failure modes

CSS cannot throw. A missing token silently falls back to the property's initial value, which is why the contract test enforces completeness for both adapters.

## Non-responsibilities

- No component or layout rules, and no React.
- No font files; the host app bundles fonts (Desktop uses `@fontsource-variable/inter` and `@fontsource/ibm-plex-mono`).
- No theme switching logic; Desktop sets `data-theme` on `:root` itself.

## Scripts

```bash
pnpm --filter @mitii/ui-theme build
pnpm --filter @mitii/ui-theme test
```
