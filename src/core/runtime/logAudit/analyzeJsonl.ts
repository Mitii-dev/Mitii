/**
 * Streaming JSONL session-log parser.
 * Returns a compact evidence packet — never the raw file contents.
 */

import { createReadStream, statSync } from 'fs';
import { createInterface } from 'readline';
import { createHash } from 'crypto';
import type {
  JsonlAnalysisReport,
  JsonlEvidenceItem,
  JsonlSessionMeta,
  JsonlTokenMetrics,
  JsonlToolMetrics,
} from './types';

const DEFAULT_MAX_EVIDENCE = 20;
const MAX_ANOMALIES = 24;

export interface AnalyzeJsonlOptions {
  includeEvidence?: boolean;
  maxEvidencePerCategory?: number;
}

export async function analyzeJsonlFile(
  absolutePath: string,
  displayPath: string,
  options: AnalyzeJsonlOptions = {}
): Promise<JsonlAnalysisReport> {
  const includeEvidence = options.includeEvidence !== false;
  const maxEvidence = Math.max(1, Math.min(options.maxEvidencePerCategory ?? DEFAULT_MAX_EVIDENCE, 50));

  const st = statSync(absolutePath);
  const eventCounts: Record<string, number> = {};
  const toolCounts: Record<string, number> = {};
  const errorCategories: Record<string, number> = {};
  const signatureCounts = new Map<string, { tool: string; count: number }>();
  const failed: JsonlToolMetrics['failed'] = [];
  const skipped: JsonlToolMetrics['skipped'] = [];
  const anomalies: string[] = [];
  const evidence: JsonlEvidenceItem[] = [];
  const pinnedFiles = new Set<string>();

  const tokens: JsonlTokenMetrics = {
    modelCalls: 0,
    inputTotal: 0,
    outputTotal: 0,
    maxInputPerCall: 0,
    cumulativeTotal: 0,
    cachedInputTotal: 0,
  };

  const session: JsonlSessionMeta = {};
  let lines = 0;
  let retrievedTokens = 0;
  let droppedItems = 0;
  let parseErrors = 0;
  let usefulAssistantFinal = false;
  let finalAssistantMessage = '';
  let terminalEventSeen = false;
  let toolEndCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  const rl = createInterface({
    input: createReadStream(absolutePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  for await (const raw of rl) {
    lines += 1;
    const line = raw.trim();
    if (!line) continue;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      parseErrors += 1;
      increment(errorCategories, 'parse_or_syntax');
      if (anomalies.length < MAX_ANOMALIES) {
        anomalies.push(`Line ${lines}: invalid JSON`);
      }
      continue;
    }

    const type = typeof event.type === 'string' ? event.type : 'unknown';
    eventCounts[type] = (eventCounts[type] ?? 0) + 1;
    session.lastEventType = type;

    const data = (event.data && typeof event.data === 'object'
      ? (event.data as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    const time = typeof event.time === 'string' ? event.time : undefined;
    const message = typeof event.message === 'string' ? event.message : '';

    if (!session.sessionId && typeof event.sessionId === 'string') {
      session.sessionId = event.sessionId;
    }
    if (!session.startedAt && time) session.startedAt = time;
    if (time) session.endedAt = time;

    if (type === 'session_start') {
      if (typeof data.model === 'string') session.model = data.model;
      if (typeof data.mode === 'string') session.mode = data.mode;
    }

    if (type === 'error' || data.hadError === true) {
      session.hadError = true;
      increment(errorCategories, categorizeError(message || String(data.error ?? 'error')));
    }

    if (type === 'assistant_message' && message.trim().length > 80) {
      usefulAssistantFinal = true;
      finalAssistantMessage = message.trim();
    }

    if (type === 'session_end' || type === 'turn_complete') {
      terminalEventSeen = true;
    }

    if (type === 'token_usage' || (type === 'info' && /token/i.test(message))) {
      accumulateTokens(tokens, data);
    }

    if (type === 'context_pack') {
      const packTokens = num(data.totalTokens) ?? num(data.usedTokens) ?? 0;
      retrievedTokens += packTokens;
      droppedItems += num(data.droppedCount) ?? 0;
      const pinned = data.pinnedContext ?? data.pinnedFiles;
      if (Array.isArray(pinned)) {
        for (const p of pinned) {
          if (typeof p === 'string') pinnedFiles.add(p);
        }
      }
    }

    if (type === 'tool_start' || type === 'tool_end') {
      const tool = String(data.tool ?? data.toolName ?? message ?? 'unknown');
      if (type === 'tool_start') {
        toolCounts[tool] = (toolCounts[tool] ?? 0) + 1;
      }

      if (type === 'tool_end') {
        toolEndCount += 1;
        const signature = canonicalToolSignature(tool, data);
        const existing = signatureCounts.get(signature) ?? { tool, count: 0 };
        existing.count += 1;
        signatureCounts.set(signature, existing);

        const success = data.success === true;
        const failure = data.failure === true || success === false;
        const skippedCall = data.skipped === true || /skipped/i.test(message);

        if (failure) failedCount += 1;
        if (skippedCall) skippedCount += 1;
        if (failure) {
          increment(errorCategories, categorizeError(String(data.error ?? data.outputPreview ?? message)));
        }

        if (failure && failed.length < maxEvidence) {
          failed.push({
            line: lines,
            tool,
            error: typeof data.error === 'string' ? data.error : undefined,
            summary: truncate(`${tool}: ${data.error ?? message}`, 160),
          });
        }
        if (skippedCall && skipped.length < maxEvidence) {
          skipped.push({
            line: lines,
            tool,
            summary: truncate(message || `${tool} skipped`, 160),
          });
        }

        // Weak success detection: exit ran but stderr/error signatures present
        const preview = String(data.outputPreview ?? data.error ?? '');
        if (success && looksLikeCommandFailure(preview) && anomalies.length < MAX_ANOMALIES) {
          anomalies.push(
            `Line ${lines}: tool "${tool}" marked success but output shows an error signature`
          );
        }
      }

      if (includeEvidence && evidence.length < maxEvidence * 3) {
        if (
          type === 'tool_end' &&
          (data.failure === true || data.success === false || data.skipped === true)
        ) {
          evidence.push({
            line: lines,
            time,
            type,
            summary: truncate(`${tool} ${data.success === false ? 'failed' : 'ended'}: ${data.error ?? message}`, 200),
          });
        }
      }
    }

    if (includeEvidence && type === 'error' && evidence.length < maxEvidence * 3) {
      evidence.push({
        line: lines,
        time,
        type,
        summary: truncate(message || JSON.stringify(data).slice(0, 160), 200),
      });
    }
  }

  if (parseErrors > 0) {
    anomalies.unshift(`${parseErrors} line(s) failed JSON parse`);
  }

  if (session.startedAt && session.endedAt) {
    const startMs = Date.parse(session.startedAt);
    const endMs = Date.parse(session.endedAt);
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
      session.durationMs = endMs - startMs;
    }
  }

  const duplicateSignatures = [...signatureCounts.entries()]
    .filter(([, v]) => v.count >= 2)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, maxEvidence)
    .map(([signature, v]) => ({ signature, count: v.count, tool: v.tool }));

  for (const dup of duplicateSignatures.slice(0, 8)) {
    if (anomalies.length >= MAX_ANOMALIES) break;
    anomalies.push(`Repeated tool signature ×${dup.count}: ${dup.tool} (${dup.signature.slice(0, 80)})`);
  }

  if (session.hadError && !usefulAssistantFinal) {
    anomalies.push('Session hadError=true and no substantial assistant_message was found');
  } else if (session.hadError && usefulAssistantFinal) {
    anomalies.push('Session hadError=true but a substantial assistant_message exists — do not equate hadError with a useless answer');
  }

  if (tokens.maxInputPerCall > 0 && tokens.cumulativeTotal > tokens.maxInputPerCall * 3) {
    anomalies.push(
      `Token accounting: max per-call input=${tokens.maxInputPerCall}, cumulative total=${tokens.cumulativeTotal} — report these separately`
    );
  }

  const completion = inferCompletionStatus({
    terminalEventSeen,
    finalAssistantMessage,
    parseErrors,
    lastEventType: session.lastEventType,
  });
  session.completed = completion.status === 'complete';
  session.completionStatus = completion.status;
  session.completionReason = completion.reason;
  if (completion.status === 'truncated') {
    anomalies.unshift(`Response appears truncated: ${completion.reason}`);
  } else if (completion.status === 'incomplete') {
    anomalies.unshift(`Log appears incomplete: ${completion.reason}`);
  }

  const hasEnoughEvidence =
    Object.keys(eventCounts).length > 0 &&
    (Object.keys(toolCounts).length > 0 || tokens.modelCalls > 0 || anomalies.length > 0);

  return {
    file: {
      path: displayPath,
      bytes: st.size,
      lines,
    },
    session,
    eventCounts,
    tokens,
    errorCategories,
    tools: {
      counts: toolCounts,
      totalCalls: toolEndCount,
      failedCount,
      skippedCount,
      failed,
      skipped,
      duplicateSignatures,
    },
    context: {
      retrievedTokens,
      droppedItems,
      pinnedFiles: [...pinnedFiles].slice(0, 20),
    },
    anomalies: anomalies.slice(0, MAX_ANOMALIES),
    evidence: evidence.slice(0, maxEvidence * 2),
    hasEnoughEvidence,
  };
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function categorizeError(text: string): string {
  const lower = text.toLowerCase();
  if (/permission|eacces|denied|approval/.test(lower)) return 'permission_or_approval';
  if (/not found|enoent|cannot find|missing/.test(lower)) return 'missing_path_or_resource';
  if (/timeout|timed out|aborted|cancel/.test(lower)) return 'timeout_or_cancelled';
  if (/parse|json|syntax/.test(lower)) return 'parse_or_syntax';
  if (/rate limit|quota|429|token|context length/.test(lower)) return 'model_or_token_limit';
  if (/command failed|exit code|stderr|usage:/.test(lower)) return 'command_failure';
  return 'other_error';
}

function inferCompletionStatus(input: {
  terminalEventSeen: boolean;
  finalAssistantMessage: string;
  parseErrors: number;
  lastEventType?: string;
}): { status: 'complete' | 'incomplete' | 'truncated'; reason: string } {
  if (input.parseErrors > 0) {
    return { status: 'truncated', reason: 'one or more JSONL records could not be parsed' };
  }
  if (!input.terminalEventSeen) {
    return {
      status: 'incomplete',
      reason: `missing terminal session_end/turn_complete event; last event=${input.lastEventType ?? 'unknown'}`,
    };
  }
  if (input.finalAssistantMessage && !looksLikeCompleteAssistantMessage(input.finalAssistantMessage)) {
    return { status: 'truncated', reason: 'last assistant_message ends mid-sentence or inside an open code fence' };
  }
  return { status: 'complete', reason: 'terminal session event observed' };
}

function looksLikeCompleteAssistantMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  const fenceCount = (trimmed.match(/```/g) ?? []).length;
  if (fenceCount % 2 !== 0) return false;
  if (/[.!?)]["'`)\]]*$/.test(trimmed)) return true;
  if (/```$/.test(trimmed)) return true;
  if (/\n\s*[-*]\s+\S.{8,}$/.test(trimmed)) return true;
  return false;
}

function accumulateTokens(tokens: JsonlTokenMetrics, data: Record<string, unknown>): void {
  const input = num(data.inputTokens) ?? num(data.promptTokens);
  const output = num(data.outputTokens) ?? num(data.completionTokens);
  const cached = num(data.cachedInputTokens) ?? num(data.cacheReadTokens) ?? 0;
  const cumulative =
    num(data.currentTurnTotal) ??
    num(data.cumulativeTotal) ??
    num(data.turnCumulativeTokens) ??
    num(data.totalTokens);

  if (input !== undefined || output !== undefined) {
    tokens.modelCalls += 1;
  }
  if (input !== undefined) {
    tokens.inputTotal += input;
    tokens.maxInputPerCall = Math.max(tokens.maxInputPerCall, input);
  }
  if (output !== undefined) {
    tokens.outputTotal += output;
  }
  if (cached) {
    tokens.cachedInputTotal += cached;
  }
  if (cumulative !== undefined) {
    tokens.cumulativeTotal = Math.max(tokens.cumulativeTotal, cumulative);
  }
}

function canonicalToolSignature(tool: string, data: Record<string, unknown>): string {
  const args: Record<string, unknown> = {};
  if (typeof data.path === 'string') args.path = data.path;
  if (typeof data.command === 'string') args.command = normalizeCommand(data.command);
  if (typeof data.inputPreview === 'string') {
    try {
      const parsed = JSON.parse(data.inputPreview) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') {
        for (const key of Object.keys(parsed).sort()) {
          args[key] = parsed[key];
        }
      }
    } catch {
      args.inputPreview = data.inputPreview.slice(0, 120);
    }
  }
  const payload = JSON.stringify({ tool, args: sortObject(args) });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

function normalizeCommand(command: string): string {
  return command.replace(/\s+/g, ' ').trim().slice(0, 200);
}

function sortObject(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = value[key];
  }
  return out;
}

function looksLikeCommandFailure(text: string): boolean {
  return /\b(invalid option|permission denied|not found|command not found|usage:|grep:\s)/i.test(text);
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function truncate(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 1)}…`;
}
