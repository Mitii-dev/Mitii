/**
 * Terminal session chrome for the Mitii CLI.
 * Prefer ASCII/Unicode that survives common terminal fonts.
 */

export const MITII_BANNER = `
  ·   · ····· ····· ····· ·····
  ·· ··   ·     ·     ·     ·
  · · ·   ·     ·     ·     ·
  ·   ·   ·     ·     ·     ·
  ·   · ·····   ·   ····· ·····
`.replace(/^\n|\n$/g, '');

export interface SessionHeaderOptions {
  cwd: string;
  providerLabel: string;
  mode: string;
  version: string;
  /** True when running the local echo stub (no live model). */
  isEcho?: boolean;
  /** Point new users at `mitii setup` when no provider is configured. */
  showSetupHint?: boolean;
}

export function formatSessionHeader(options: SessionHeaderOptions): string {
  const lines = [
    MITII_BANNER,
    '',
    `  Mitii CLI v${options.version}  ·  headless agent`,
    `  workspace  ${options.cwd}`,
    `  provider   ${options.providerLabel}`,
    `  mode       ${options.mode}`,
    '',
  ];

  if (options.showSetupHint) {
    lines.push(
      '  No live model yet — answers use the local echo stub.',
      '  Run  mitii setup  to choose a provider and write config.',
      '',
    );
  } else if (options.isEcho) {
    lines.push(
      '  Echo mode (--echo or provider=echo) — local stub, no remote API.',
      '',
    );
  }

  lines.push(
    '  Empty line or Ctrl-D to exit · Ctrl-C cancels the active run',
    '  Modes: ask (Q&A) · plan (read-only plan) · agent (edit + verify)',
    '',
  );

  return `${lines.join('\n')}\n`;
}
