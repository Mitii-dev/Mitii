/**
 * Append-only project logs under layout.logsPath (Root/projects/…/logs).
 *
 * Files:
 * - engine.log           — engine process stdout/stderr
 * - runs.log             — agent run lifecycle
 * - desktop-YYYY-MM-DD.log — product failures (store, settings, index, boot)
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type DesktopLogLevel = 'info' | 'warn' | 'error';

/** Categories for desktop product events (date-stamped log). */
export type DesktopLogCategory =
  | 'boot'
  | 'store'
  | 'sqlite'
  | 'settings'
  | 'indexing'
  | 'engine'
  | 'ipc'
  | 'workspace'
  | 'storage'
  | 'general';

export function resolveLogsDir(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const fromExplicit = explicit?.trim();
  if (fromExplicit) return fromExplicit;
  const fromEnv = env.MITII_LOGS_PATH?.trim();
  return fromEnv || undefined;
}

/** `desktop-2026-10-01.log` — one file per calendar day (UTC date). */
export function desktopLogFileName(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `desktop-${y}-${m}-${d}.log`;
}

export function appendProjectLog(
  logsDir: string | undefined,
  fileName: string,
  line: string,
): void {
  if (!logsDir?.trim()) return;
  try {
    mkdirSync(logsDir, { recursive: true });
    const stamp = new Date().toISOString();
    const body = line.endsWith('\n') ? line : `${line}\n`;
    appendFileSync(join(logsDir, fileName), `[${stamp}] ${body}`, 'utf8');
  } catch {
    // Logging must never break the product path.
  }
}

export function appendEngineLog(
  logsDir: string | undefined,
  stream: 'stdout' | 'stderr',
  chunk: string,
): void {
  const text = chunk.replace(/\s+$/, '');
  if (!text) return;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    appendProjectLog(logsDir, 'engine.log', `[${stream}] ${line}`);
  }
}

export function appendRunLog(
  logsDir: string | undefined,
  message: string,
  extra?: Record<string, unknown>,
): void {
  const payload =
    extra && Object.keys(extra).length > 0
      ? `${message} ${JSON.stringify(extra)}`
      : message;
  appendProjectLog(logsDir, 'runs.log', payload);
}

/**
 * Date-stamped desktop product log for store/settings/index/boot failures.
 * Also mirrored lightly into `runs.log` for indexing so the run timeline stays complete.
 */
export function appendDesktopLog(
  logsDir: string | undefined,
  category: DesktopLogCategory,
  message: string,
  options?: {
    level?: DesktopLogLevel;
    extra?: Record<string, unknown>;
    /** Also append a short line to runs.log (indexing / engine). */
    mirrorRuns?: boolean;
  },
): void {
  const level = options?.level ?? 'info';
  const extra = options?.extra;
  const payload =
    extra && Object.keys(extra).length > 0
      ? `${message} ${JSON.stringify(extra)}`
      : message;
  const line = `${level.toUpperCase()} [${category}] ${payload}`;
  appendProjectLog(logsDir, desktopLogFileName(), line);
  if (options?.mirrorRuns) {
    appendRunLog(logsDir, `desktop_${category} ${payload}`);
  }
}

/** Resolve error message without throwing. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
