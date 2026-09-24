/**
 * Live run log written beside the workspace so the canvas can show which
 * node is running before the final report exists.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type RunNodeState = 'queued' | 'running' | 'done' | 'failed';

export interface RunLogLine {
  at: string;
  text: string;
  tone?: 'info' | 'ok' | 'err';
}

export interface RunLiveLog {
  runId: string;
  nodes: Record<string, RunNodeState>;
  lines: RunLogLine[];
}

export function runLogPath(workspaceRoot: string, runId: string): string {
  return join(workspaceRoot, '.mitii', 'run-logs', `${runId}.json`);
}

export function readRunLog(
  workspaceRoot: string | null | undefined,
  runId: string,
): RunLiveLog | null {
  if (!workspaceRoot?.trim() || !runId.trim()) return null;
  try {
    const raw = readFileSync(runLogPath(workspaceRoot, runId), 'utf8');
    const parsed = JSON.parse(raw) as RunLiveLog;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      runId,
      nodes: parsed.nodes ?? {},
      lines: Array.isArray(parsed.lines) ? parsed.lines : [],
    };
  } catch {
    return null;
  }
}

export function writeRunLog(workspaceRoot: string, log: RunLiveLog): void {
  const path = runLogPath(workspaceRoot, log.runId);
  mkdirSync(join(workspaceRoot, '.mitii', 'run-logs'), { recursive: true });
  writeFileSync(path, JSON.stringify(log), 'utf8');
}

export function patchRunLog(
  workspaceRoot: string,
  runId: string,
  patch: (current: RunLiveLog) => RunLiveLog,
): RunLiveLog {
  const current = readRunLog(workspaceRoot, runId) ?? {
    runId,
    nodes: {},
    lines: [],
  };
  const next = patch(current);
  const capped = {
    ...next,
    lines: next.lines.slice(-200),
  };
  writeRunLog(workspaceRoot, capped);
  return capped;
}
