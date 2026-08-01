import { appendFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentRunResult, RunEvent } from '@mitii/sdk';

import { mitiiLogsDir } from './mitiiWorkspace.js';

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function logStamp(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();
  const hour24 = date.getHours();
  const hour12 = String(hour24 % 12 || 12).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const meridiem = hour24 >= 12 ? 'PM' : 'AM';
  return `${month}-${day}-${year}-${hour12}-${minute}-${meridiem}`;
}

function safeLogId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96) || 'session';
}

function findExistingLogFile(dir: string, id: string): string | undefined {
  const suffix = `-${id}.jsonl`;
  const prefixPattern = /^\d{2}-\d{2}-\d{4}-\d{2}-\d{2}-(?:AM|PM)-/;
  try {
    const names = readdirSync(dir)
      .filter((name) => prefixPattern.test(name) && name.endsWith(suffix))
      .sort();
    const existing = names[0];
    return existing ? join(dir, existing) : undefined;
  } catch {
    return undefined;
  }
}

function writeLine(file: string, entry: unknown): void {
  appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
}

function compactText(text: string | undefined, maxChars = 4000): {
  text?: string;
  chars: number;
  truncated: boolean;
} {
  const value = text ?? '';
  if (!value) return { chars: 0, truncated: false };
  if (value.length <= maxChars) {
    return { text: value, chars: value.length, truncated: false };
  }
  return {
    text: `${value.slice(0, maxChars)}…`,
    chars: value.length,
    truncated: true,
  };
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
        ...(event.kind === 'tool_call' ? { preview: event.preview } : {}),
      };
    case 'tool_started':
      return { ...base, toolName: event.toolName, summary: event.summary };
    case 'tool_completed':
      return {
        ...base,
        toolName: event.toolName,
        summary: event.summary,
        status: event.status,
      };
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
        selected: 'selected' in event ? event.selected : undefined,
        omitted: 'omitted' in event ? event.omitted : undefined,
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
    case 'verification_completed':
      return {
        ...base,
        status: event.status,
        reasonCodes: event.reasonCodes,
        checks: event.checks,
        diagnostics: event.diagnostics,
        warnings: event.warnings,
      };
    case 'terminal':
      const answer = compactText(event.result.answer, 1200);
      return {
        ...base,
        status: event.status,
        usage: event.result.usage,
        answerChars: answer.chars,
        answerTruncated: answer.truncated,
        ...(answer.text ? { answerPreview: answer.text } : {}),
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
  /** Prior user/assistant turns forwarded into the engine for this run. */
  conversationCount?: number;
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
  const sessionId = safeLogId(options.sessionId ?? entry.result.runId ?? 'session');
  const file =
    findExistingLogFile(dir, sessionId) ??
    join(dir, `${logStamp()}-${sessionId}.jsonl`);

  writeLine(file, {
    kind: 'run_start',
    at: entry.at,
    sessionId,
    prompt: entry.prompt,
    mode: entry.mode,
    conversationCount: entry.conversationCount ?? 0,
    runId: entry.result.runId,
    requestId: entry.result.requestId,
  });

  for (const event of entry.events) {
    // Skip per-token text/reasoning previews that duplicate the final answer
    // and make logs unreadable; keep tool-call deltas and structured events.
    if (event.type === 'model_delta' && event.kind !== 'tool_call') {
      continue;
    }
    writeLine(file, compactEvent(event));
  }

  const answer = compactText(entry.result.answer);
  writeLine(file, {
    kind: 'run_end',
    at: new Date().toISOString(),
    runId: entry.result.runId,
    status: entry.result.status,
    route: entry.result.route,
    usage: entry.result.usage,
    durationMs: entry.result.durationMs,
    answerChars: answer.chars,
    answerTruncated: answer.truncated,
    ...(answer.text ? { answer: answer.text } : {}),
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
