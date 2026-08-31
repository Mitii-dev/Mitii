import { createHash, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function nowIso(date: Date = new Date()): string {
  return date.toISOString();
}

/** Default automation home: ~/.mitii/automation */
export function resolveAutomationHome(
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (env.MITII_AUTOMATION_HOME?.trim()) {
    return env.MITII_AUTOMATION_HOME.trim();
  }
  return join(homedir(), '.mitii', 'automation');
}

export function resolveAutomationDbPath(
  options: { dbPath?: string; env?: NodeJS.ProcessEnv } = {},
): string {
  const env = options.env ?? process.env;
  if (options.dbPath?.trim()) {
    return options.dbPath.trim();
  }
  if (env.MITII_AUTOMATION_DB?.trim()) {
    return env.MITII_AUTOMATION_DB.trim();
  }
  return join(resolveAutomationHome(env), 'automation.db');
}

export function resolveAutomationReportsDir(dbPath: string): string {
  return join(dbPath, '..', 'reports');
}

export function resolveWorkspaceCronDir(workspaceRoot: string): string {
  return join(workspaceRoot, '.mitii', 'cron');
}

export function resolveGlobalCronDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (env.MITII_CRON_DIR?.trim()) {
    return env.MITII_CRON_DIR.trim();
  }
  return join(homedir(), '.mitii', 'cron');
}
