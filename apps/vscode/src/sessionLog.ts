import { appendFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentRunResult, RunEvent } from '@mitii/sdk';

import { mitiiLogsDir } from './mitiiWorkspace.js';

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export interface SessionLogAppend {
  kind: 'run';
  at: string;
  prompt: string;
  mode?: string;
  result: AgentRunResult;
  events: RunEvent[];
}

/**
 * Append-only JSONL session log under \`.mitii/logs/\`.
 * Creates the directory on first write.
 */
export function appendSessionLog(
  workspaceRoot: string | undefined,
  entry: SessionLogAppend,
  options: { sessionId?: string } = {},
): string | undefined {
  if (!workspaceRoot) return undefined;
  const dir = mitiiLogsDir(workspaceRoot);
  mkdirSync(dir, { recursive: true });
  const sessionId = options.sessionId ?? 'vscode_session';
  const file = join(dir, `${stamp()}-${sessionId}.jsonl`);
  appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
  return file;
}

/** Write a one-shot session export JSON under \`.mitii/logs/\`. */
export function writeSessionExport(
  workspaceRoot: string | undefined,
  fallbackDir: string,
  payload: unknown,
): string {
  const dir = workspaceRoot ? mitiiLogsDir(workspaceRoot) : fallbackDir;
  mkdirSync(dir, { recursive: true });
  const outPath = join(dir, `session-export-${stamp()}.json`);
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return outPath;
}

/** Newest session log or export under \`.mitii/logs/\`, if any. */
export function findLatestSessionLog(
  workspaceRoot: string | undefined,
): string | undefined {
  if (!workspaceRoot) return undefined;
  const dir = mitiiLogsDir(workspaceRoot);
  try {
    const names = readdirSync(dir)
      .filter(
        (name) =>
          name.endsWith('.jsonl') ||
          (name.startsWith('session-export-') && name.endsWith('.json')),
      )
      .sort();
    const last = names[names.length - 1];
    return last ? join(dir, last) : undefined;
  } catch {
    return undefined;
  }
}
