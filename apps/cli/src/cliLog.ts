import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { resolveMitiiCliPaths } from './cliPaths.js';

export interface CliSessionLogHandle {
  path: string;
  write: (event: Record<string, unknown>) => void;
}

/**
 * CLI session logs (NDJSON) under .mitii/logs or MITII_LOGS_PATH.
 * Disabled when MITII_CLI_LOG=0.
 */
export function openCliSessionLog(
  cwd: string,
  meta: Record<string, unknown> = {},
): CliSessionLogHandle | null {
  const disabled =
    process.env.MITII_CLI_LOG === '0' || process.env.MITII_CLI_LOG === 'false';
  if (disabled) return null;

  const { logsDir } = resolveMitiiCliPaths(cwd);
  mkdirSync(logsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(logsDir, `cli-${stamp}.jsonl`);

  const write = (event: Record<string, unknown>) => {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      ...event,
    });
    appendFileSync(path, `${line}\n`, 'utf8');
  };

  write({ type: 'session_start', cwd, ...meta });
  return { path, write };
}
