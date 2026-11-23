/**
 * Terminal session chrome for the Mitii CLI.
 */

import { loadModeProfiles, readIndexPipelineHealth } from '@mitii/host';

import { loadMitiiHostConfig } from './config.js';
import {
  createTermStyle,
  type TermStyle,
} from './termStyle.js';
import { detectGitWorkspace } from './workspaceBootstrap.js';

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
  profile?: string | null;
  /** Inject style for tests (disable color). */
  style?: TermStyle;
  /** Skip live index/git probes (tests). */
  indexOverall?: string;
  gitPresent?: boolean;
}

function statusBadge(
  style: TermStyle,
  kind: 'ok' | 'warn' | 'danger' | 'neutral',
  label: string,
): string {
  if (kind === 'ok') return style.ok(label);
  if (kind === 'warn') return style.warn(label);
  if (kind === 'danger') return style.danger(label);
  return style.muted(label);
}

function row(style: TermStyle, label: string, value: string): string {
  return `  ${style.label(label)} ${value}`;
}

function resolveIndexOverall(cwd: string, override?: string): string {
  if (override) return override;
  try {
    return readIndexPipelineHealth({ workspaceRoot: cwd }).overall;
  } catch {
    return 'unknown';
  }
}

function resolveActiveProfile(cwd: string, override?: string | null): string {
  if (override !== undefined && override !== null) return override;
  if (override === null) return '';
  try {
    return loadModeProfiles(cwd).activeSlug ?? '';
  } catch {
    return '';
  }
}

function formatIndexStatus(style: TermStyle, overall: string): string {
  switch (overall) {
    case 'ready':
      return statusBadge(style, 'ok', 'ready');
    case 'lexical_only':
      return statusBadge(style, 'warn', 'lexical only (embeddings pending)');
    case 'running':
      return statusBadge(style, 'warn', 'indexing…');
    case 'missing':
      return statusBadge(style, 'warn', 'not indexed — run /index or mitii init');
    case 'failed':
      return statusBadge(style, 'danger', 'failed — run mitii index');
    default:
      return statusBadge(style, 'neutral', overall || 'unknown');
  }
}

/**
 * Enterprise session header: brand mark + workspace readiness board.
 */
export function formatSessionHeader(options: SessionHeaderOptions): string {
  const style = options.style ?? createTermStyle(process.stderr);
  const config = loadMitiiHostConfig(options.cwd);
  const git =
    options.gitPresent !== undefined
      ? { present: options.gitPresent, rootHint: options.cwd }
      : detectGitWorkspace(options.cwd);
  const indexOverall = resolveIndexOverall(options.cwd, options.indexOverall);
  const profile = resolveActiveProfile(options.cwd, options.profile);
  const model =
    config.model?.trim() ||
    (options.providerLabel.includes(':')
      ? options.providerLabel.split(':').slice(1).join(':')
      : '');

  const readiness =
    options.showSetupHint
      ? statusBadge(style, 'warn', 'SETUP REQUIRED')
      : options.isEcho
        ? statusBadge(style, 'warn', 'ECHO MODE')
        : indexOverall === 'missing' || indexOverall === 'failed'
          ? statusBadge(style, 'warn', 'INDEX REQUIRED')
          : statusBadge(style, 'ok', 'READY');

  const banner = MITII_BANNER.split('\n')
    .map((line) => `  ${style.brand(line.trimEnd())}`)
    .join('\n');

  const lines: string[] = [
    '',
    banner,
    '',
    `  ${style.bold('Mitii')} ${style.muted(`CLI v${options.version}`)}  ·  ${style.muted('enterprise agent runtime')}`,
    `  ${style.rule(52)}`,
    row(style, 'Status', readiness),
    row(style, 'Workspace', style.text(options.cwd)),
    row(
      style,
      'Git',
      git.present
        ? style.ok('detected')
        : style.warn('not a git repository'),
    ),
    row(style, 'Index', formatIndexStatus(style, indexOverall)),
    row(style, 'Provider', style.text(options.providerLabel)),
  ];

  if (model) {
    lines.push(row(style, 'Model', style.text(model)));
  }

  lines.push(
    row(
      style,
      'Mode',
      profile
        ? `${style.text(options.mode)}${style.muted(`  · profile ${profile}`)}`
        : style.text(options.mode),
    ),
  );

  lines.push(`  ${style.rule(52)}`);

  if (options.showSetupHint) {
    lines.push(
      `  ${style.warn('No live model configured.')}`,
      `  ${style.muted('Run')} ${style.brand('mitii setup')} ${style.muted('then')} ${style.brand('mitii init')}${style.muted('.')}`,
    );
  } else if (options.isEcho) {
    lines.push(
      `  ${style.warn('Echo stub active')} ${style.muted('— local responses only, no remote model.')}`,
    );
  } else if (indexOverall === 'missing') {
    lines.push(
      `  ${style.muted('Tip:')} ${style.brand('mitii init')} ${style.muted('or')} ${style.brand('/index')} ${style.muted('to build repository context.')}`,
    );
  }

  lines.push(
    `  ${style.muted('Commands:')} ${style.brand('/help')} ${style.muted('·')} ${style.brand('/init')} ${style.muted('·')} ${style.brand('/mode')} ${style.muted('·')} ${style.brand('/index')} ${style.muted('·')} ${style.brand('/exit')}`,
    `  ${style.muted('Ctrl-C cancels the active run · Ctrl-D exits')}`,
    '',
  );

  return `${lines.join('\n')}\n`;
}
