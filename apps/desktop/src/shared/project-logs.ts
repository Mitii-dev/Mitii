/**
 * Append-only project logs under layout.logsPath (Root/projects/…/logs).
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function resolveLogsDir(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const fromExplicit = explicit?.trim();
  if (fromExplicit) return fromExplicit;
  const fromEnv = env.MITII_LOGS_PATH?.trim();
  return fromEnv || undefined;
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
