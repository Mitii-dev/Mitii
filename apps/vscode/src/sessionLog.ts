import { appendFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentRunResult, RunEvent } from '@mitii/sdk';

import { mitiiLogsDir } from './mitiiWorkspace.js';

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function dayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function writeLine(file: string, entry: unknown): void {
  appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
}

function compactEvent(event: RunEvent): Record<string, unknown> {
  const base: Record<string, unknown> = {
    kind: 'event',
    at: 'at' in event && typeof event.at === 'string' ? event.at : new Date().toISOString(),
    type: event.type,
  };

  switch (event.type) {
    case 'stage_started':
    case 'stage_completed':
      return { ...base, stage: event.stage, reasonCodes: 'reasonCodes' in event ? event.reasonCodes : undefined };
    case 'decision_made':
      return {
        ...base,
        route: event.route,
        runDisposition: event.runDisposition,
      };
    case 'model_delta':
      return {
        ...base,
        deltaKind: event.kind,
        preview: event.preview,
      };
    case 'tool_started':
      return { ...base, toolName: event.toolName };
    case 'tool_completed':
      return { ...base, toolName: event.toolName, status: event.status };
    case 'context_ready':
      return {
        ...base,
        blockCount: event.blockCount,
        status: event.status,
        paths: 'paths' in event ? event.paths : undefined,
      };
    case 'skills_ready':
    case 'memory_ready':
      return {
        ...base,
        selectedCount: event.selectedCount,
        omittedCount: event.omittedCount,
        status: event.status,
      };
    case 'suspended':
      return {
        ...base,
        suspensionKind: event.kind,
        rationale: event.rationale,
      };
    case 'warning':
      return { ...base, message: event.message };
    case 'terminal':
      return {
        ...base,
        status: event.status,
        usage: event.result.usage,
        answerChars: (event.result.answer ?? '').length,
        error: event.result.error?.message,
      };
    case 'state_pinned':
      return {
        ...base,
        stateToken: event.state.stateToken?.slice(0, 16),
      };
    default:
      return base;
  }
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
 * Append-only JSONL session log under `.mitii/logs/`.
 * One timestamped line per event (not a single nested blob).
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
  const file = join(dir, `${dayStamp()}-${sessionId}.jsonl`);

  writeLine(file, {
    kind: 'run_start',
    at: entry.at,
    prompt: entry.prompt,
    mode: entry.mode,
    runId: entry.result.runId,
    requestId: entry.result.requestId,
  });

  for (const event of entry.events) {
    // Skip per-token reasoning previews that only duplicate the stream;
    // keep content + tool_call deltas and all non-delta events.
    if (event.type === 'model_delta' && event.kind === 'reasoning') {
      continue;
    }
    writeLine(file, compactEvent(event));
  }

  writeLine(file, {
    kind: 'run_end',
    at: new Date().toISOString(),
    runId: entry.result.runId,
    status: entry.result.status,
    route: entry.result.route,
    usage: entry.result.usage,
    durationMs: entry.result.durationMs,
    answer: entry.result.answer,
    error: entry.result.error,
    reasonCodes: entry.result.reasonCodes,
  });

  return file;
}

/** Write a one-shot session export JSON under `.mitii/logs/`. */
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

/** Newest session log or export under `.mitii/logs/`, if any. */
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
