import {
  createMitiiThreadSessionId,
  MITII_LOG_STAMP_PREFIX,
} from '@mitii/host';

import { resolveMitiiCliPaths } from './cliPaths.js';

export type CliSessionLogMode = 'off' | 'full';

/**
 * CLI session logging mode.
 *
 * - unset / `1` / `true` / `full` → Desktop/VS Code–parity thread JSONL (default)
 * - `0` / `false` / `off` / `none` → disabled
 */
export function resolveCliSessionLogMode(
  env: NodeJS.ProcessEnv = process.env,
): CliSessionLogMode {
  const raw = env.MITII_CLI_LOG?.trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'none') {
    return 'off';
  }
  return 'full';
}

export function isCliSessionLogEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveCliSessionLogMode(env) === 'full';
}

export function newCliThreadSessionId(): string {
  return createMitiiThreadSessionId();
}

export function resolveCliLogsDir(cwd: string): string {
  return resolveMitiiCliPaths(cwd).logsDir;
}

/** Session JSONL names written by host openSessionLog (and legacy cli-*.jsonl). */
export function isCliSessionLogFileName(name: string): boolean {
  if (!name.endsWith('.jsonl') || name.endsWith('-model-io.jsonl')) {
    return false;
  }
  if (name.startsWith('cli-')) return true;
  return MITII_LOG_STAMP_PREFIX.test(name);
}
