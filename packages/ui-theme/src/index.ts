/**
 * Names of every `--mitii-*` custom property in the theme contract.
 * Adapters (`vscode.css`, `standalone.css`) must define all of them, either
 * directly or through the shared `tokens.css`.
 */
export const MITII_THEME_TOKENS = [
  '--mitii-brand',
  '--mitii-brand-hover',
  '--mitii-brand-soft',
  '--mitii-brand-tint',
  '--mitii-brand-on',
  '--mitii-accent',
  '--mitii-accent-soft',
  '--mitii-surface',
  '--mitii-panel',
  '--mitii-panel-raised',
  '--mitii-border',
  '--mitii-border-soft',
  '--mitii-text',
  '--mitii-muted',
  '--mitii-chat-fg',
  '--mitii-danger',
  '--mitii-ok',
  '--mitii-warn',
  '--mitii-warn-soft',
  '--mitii-radius',
  '--mitii-radius-lg',
  '--mitii-space-x',
  '--mitii-font-ui',
  '--mitii-font-tool',
  '--mitii-font-file',
  '--mitii-font-thinking',
  '--mitii-font-mono',
  '--mitii-shadow-soft',
  '--mitii-shadow-tight',
] as const;

export type MitiiThemeToken = (typeof MITII_THEME_TOKENS)[number];

/** Package-relative CSS entry points (for tooling; apps import the CSS directly). */
export const MITII_THEME_ENTRY_POINTS = {
  tokens: '@mitii/ui-theme/tokens.css',
  vscode: '@mitii/ui-theme/vscode.css',
  standalone: '@mitii/ui-theme/standalone.css',
} as const;
