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

const SESSION_LOG_SIZE_POLICY = {
  charsPerTokenEstimate: 4,
  terminalPreviewOutputWindowRatio: 0.25,
  runEndAnswerContextWindowRatio: 1,
  /** Legacy floors when the host omits model context settings. */
  fallbackTerminalAnswerPreviewChars: 1_200,
  fallbackRunEndAnswerMaxChars: 4_000,
} as const;

export interface SessionLogTextLimits {
  terminalAnswerPreviewChars?: number;
  runEndAnswerMaxChars?: number;
}

export function resolveSessionLogTextLimits(settings: {
  contextWindowTokens?: number;
  maximumOutputTokens?: number;
}): SessionLogTextLimits {
  const contextWindowTokens = normalizePositiveNumber(
    settings.contextWindowTokens,
  );
  if (!contextWindowTokens) {
    return {
      terminalAnswerPreviewChars:
        SESSION_LOG_SIZE_POLICY.fallbackTerminalAnswerPreviewChars,
      runEndAnswerMaxChars:
        SESSION_LOG_SIZE_POLICY.fallbackRunEndAnswerMaxChars,
    };
  }

  const maximumOutputTokens =
    normalizePositiveNumber(settings.maximumOutputTokens) ??
    contextWindowTokens;
  const effectiveOutputTokens = Math.min(
    maximumOutputTokens,
    contextWindowTokens,
  );

  return {
    terminalAnswerPreviewChars: tokensToChars(
      effectiveOutputTokens,
      SESSION_LOG_SIZE_POLICY.terminalPreviewOutputWindowRatio,
    ),
    runEndAnswerMaxChars: tokensToChars(
      contextWindowTokens,
      SESSION_LOG_SIZE_POLICY.runEndAnswerContextWindowRatio,
    ),
  };
}

function normalizePositiveNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

function tokensToChars(tokens: number, ratio: number): number {
  return Math.max(
    1,
    Math.floor(tokens * ratio * SESSION_LOG_SIZE_POLICY.charsPerTokenEstimate),
  );
}

function compactText(text: string | undefined, maxChars?: number): {
  text?: string;
  chars: number;
  truncated: boolean;
} {
  const value = text ?? '';
  if (!value) return { chars: 0, truncated: false };
  if (
    maxChars === undefined ||
    !Number.isFinite(maxChars) ||
    maxChars <= 0 ||
    value.length <= maxChars
  ) {
    return { text: value, chars: value.length, truncated: false };
  }
  return {
    text: `${value.slice(0, maxChars)}…`,
    chars: value.length,
    truncated: true,
  };
}

function compactEvent(
  event: RunEvent,
  limits: SessionLogTextLimits,
): Record<string, unknown> {
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
        maximumWorkspaceEffect: event.maximumWorkspaceEffect,
        approvalMode: event.approvalMode,
        pathScopes: event.pathScopes,
        trace: event.trace,
      };
    case 'grant_narrowed':
      return {
        ...base,
        maximumWorkspaceEffect: event.maximumWorkspaceEffect,
        approvalMode: event.approvalMode,
        pathScopes: event.pathScopes,
        reasonCodes: event.reasonCodes,
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
        omittedDetails:
          'omittedDetails' in event ? event.omittedDetails : undefined,
        status: event.status,
      };
    case 'task_list_updated':
      return {
        ...base,
        source: event.source,
        completedCount: event.completedCount,
        totalCount: event.totalCount,
        activeId: event.activeId,
      };
    case 'discovery_started':
      return {
        ...base,
        objective: event.objective,
      };
    case 'discovery_progress':
      return {
        ...base,
        filesRead: event.filesRead,
        searches: event.searches,
        summary: event.summary,
      };
    case 'discovery_completed':
      return {
        ...base,
        confidence: event.confidence,
        fileCount: event.fileCount,
        surfaceCount: event.surfaceCount,
        openQuestionCount: event.openQuestionCount,
      };
    case 'plan_ready':
      return {
        ...base,
        planningDepth: event.planningDepth,
        phaseCount: event.phaseCount,
        approvalRequired: event.approvalRequired,
        ...(event.plan
          ? {
              objective: event.plan.objective,
              stepCount: event.plan.phases.reduce(
                (
                  sum: number,
                  phase: NonNullable<typeof event.plan>['phases'][number],
                ) => sum + phase.steps.length,
                0,
              ),
            }
          : {}),
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
      const answer = compactText(
        event.result.answer,
        limits.terminalAnswerPreviewChars,
      );
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

export interface SessionLogOpenOptions {
  at: string;
  prompt: string;
  mode?: string;
  conversationCount?: number;
  sessionId?: string;
  runId: string;
  requestId?: string;
  contextWindowTokens?: number;
  maximumOutputTokens?: number;
}

/**
 * Live append-only JSONL writer under `.mitii/logs/`.
 * Call {@link SessionLogWriter.appendEvent} during the run and
 * {@link SessionLogWriter.finish} once when the run terminates.
 */
export interface SessionLogWriter {
  readonly path: string;
  appendEvent(event: RunEvent): void;
  finish(result: AgentRunResult): void;
}

function shouldPersistEvent(event: RunEvent): boolean {
  // Skip per-token text/reasoning previews that duplicate the final answer
  // and make logs unreadable; keep tool-call deltas and structured events.
  return !(event.type === 'model_delta' && event.kind !== 'tool_call');
}

/**
 * Open a session log immediately so the file exists and grows while the run
 * is in progress (not only after terminal).
 */
export function openSessionLog(
  workspaceRoot: string | undefined,
  options: SessionLogOpenOptions,
): SessionLogWriter | undefined {
  if (!workspaceRoot) return undefined;

  const textLimits = resolveSessionLogTextLimits(options);
  const dir = mitiiLogsDir(workspaceRoot);
  mkdirSync(dir, { recursive: true });
  const sessionId = safeLogId(options.sessionId ?? options.runId);
  const file =
    findExistingLogFile(dir, sessionId) ??
    join(dir, `${logStamp()}-${sessionId}.jsonl`);

  writeLine(file, {
    kind: 'run_start',
    at: options.at,
    sessionId,
    prompt: options.prompt,
    mode: options.mode,
    conversationCount: options.conversationCount ?? 0,
    runId: options.runId,
    ...(options.requestId ? { requestId: options.requestId } : {}),
  });

  let finished = false;

  return {
    path: file,
    appendEvent(event: RunEvent): void {
      if (finished || !shouldPersistEvent(event)) return;
      writeLine(file, compactEvent(event, textLimits));
    },
    finish(result: AgentRunResult): void {
      if (finished) return;
      finished = true;
      const answer = compactText(
        result.answer,
        textLimits.runEndAnswerMaxChars,
      );
      writeLine(file, {
        kind: 'run_end',
        at: new Date().toISOString(),
        runId: result.runId,
        ...(result.requestId ? { requestId: result.requestId } : {}),
        status: result.status,
        route: result.route,
        usage: result.usage,
        durationMs: result.durationMs,
        answerChars: answer.chars,
        answerTruncated: answer.truncated,
        ...(answer.text ? { answer: answer.text } : {}),
        error: result.error,
        reasonCodes: result.reasonCodes,
      });
    },
  };
}

/**
 * Batch helper for tests / one-shot callers.
 * Prefer {@link openSessionLog} during live runs so events stream to disk.
 */
export function appendSessionLog(
  workspaceRoot: string | undefined,
  entry: SessionLogAppend,
  options: {
    sessionId?: string;
    contextWindowTokens?: number;
    maximumOutputTokens?: number;
  } = {},
): string | undefined {
  const writer = openSessionLog(workspaceRoot, {
    at: entry.at,
    prompt: entry.prompt,
    mode: entry.mode,
    conversationCount: entry.conversationCount,
    sessionId: options.sessionId,
    runId: entry.result.runId,
    requestId: entry.result.requestId,
    contextWindowTokens: options.contextWindowTokens,
    maximumOutputTokens: options.maximumOutputTokens,
  });
  if (!writer) return undefined;

  for (const event of entry.events) {
    writer.appendEvent(event);
  }
  writer.finish(entry.result);
  return writer.path;
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
