import { existsSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { analyzeJsonlFile } from './analyzeJsonl';
import type {
  JsonlAnalysisReport,
  JsonlTokenMetrics,
  LogDirectoryAnalysisReport,
  LogDirectoryFileResult,
} from './types';

const ACTIVE_MTIME_WINDOW_MS = 120_000;
const MAX_RANKED_ANOMALIES = 40;

export interface AnalyzeLogDirectoryOptions {
  includeActive?: boolean;
  includeIncomplete?: boolean;
  activeLogPath?: string;
}

export async function analyzeLogDirectory(
  absoluteDirectory: string,
  displayDirectory: string,
  options: AnalyzeLogDirectoryOptions = {}
): Promise<LogDirectoryAnalysisReport> {
  const dir = resolve(absoluteDirectory);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`Log directory not found: ${displayDirectory}`);
  }

  const names = readdirSync(dir)
    .filter((name) => /\.jsonl$/i.test(name))
    .sort((a, b) => a.localeCompare(b));

  const activeLogPath = options.activeLogPath ? resolve(options.activeLogPath) : undefined;
  const newestMtime = names.reduce((max, name) => {
    try {
      return Math.max(max, statSync(join(dir, name)).mtimeMs);
    } catch {
      return max;
    }
  }, 0);

  const files: LogDirectoryFileResult[] = [];
  const eventCounts: Record<string, number> = {};
  const toolCounts: Record<string, number> = {};
  const duplicateMap = new Map<string, { signature: string; count: number; tool: string; files: Set<string> }>();
  const errorMap = new Map<string, { category: string; count: number; files: Set<string> }>();
  const sessionIds = new Set<string>();
  const anomalies: Array<{ severity: 'high' | 'medium' | 'low'; score: number; file?: string; message: string }> = [];
  const tokens: JsonlTokenMetrics = {
    modelCalls: 0,
    inputTotal: 0,
    outputTotal: 0,
    maxInputPerCall: 0,
    cumulativeTotal: 0,
    cachedInputTotal: 0,
  };
  const totals = {
    filesListed: names.length,
    filesIncluded: 0,
    filesExcluded: 0,
    bytesIncluded: 0,
    linesIncluded: 0,
    sessionsIncluded: 0,
    incompleteLogs: 0,
    truncatedLogs: 0,
    activeLogs: 0,
    toolCalls: 0,
    failedToolCalls: 0,
    skippedToolCalls: 0,
  };

  for (const name of names) {
    const absolutePath = join(dir, name);
    const displayPath = `${displayDirectory.replace(/\/+$/, '')}/${name}`;
    const st = statSync(absolutePath);
    const report = await analyzeJsonlFile(absolutePath, displayPath, {
      includeEvidence: false,
      maxEvidencePerCategory: 3,
    });
    const incomplete = report.session.completionStatus === 'incomplete';
    const truncated = report.session.completionStatus === 'truncated';
    const active =
      Boolean(activeLogPath && resolve(absolutePath) === activeLogPath) ||
      (incomplete && st.mtimeMs === newestMtime && Date.now() - st.mtimeMs <= ACTIVE_MTIME_WINDOW_MS);
    const included = Boolean(
      (!active || options.includeActive) &&
      (!incomplete && !truncated || options.includeIncomplete)
    );
    const reason = buildInclusionReason({ active, incomplete, truncated, included });

    if (active) totals.activeLogs += 1;
    if (incomplete) totals.incompleteLogs += 1;
    if (truncated) totals.truncatedLogs += 1;

    const file: LogDirectoryFileResult = {
      path: displayPath,
      bytes: report.file.bytes,
      lines: report.file.lines,
      mtimeMs: st.mtimeMs,
      included,
      reason,
      active,
      incomplete,
      truncated,
      sessionId: report.session.sessionId,
      startedAt: report.session.startedAt,
      endedAt: report.session.endedAt,
      mode: report.session.mode,
      model: report.session.model,
      hadError: report.session.hadError,
    };
    files.push(file);

    if (!included) {
      totals.filesExcluded += 1;
      anomalies.push({
        severity: active ? 'medium' : 'high',
        score: active ? 70 : 90,
        file: displayPath,
        message: reason,
      });
      continue;
    }

    totals.filesIncluded += 1;
    totals.bytesIncluded += report.file.bytes;
    totals.linesIncluded += report.file.lines;
    totals.toolCalls += report.tools.totalCalls;
    totals.failedToolCalls += report.tools.failedCount;
    totals.skippedToolCalls += report.tools.skippedCount;
    if (report.session.sessionId) sessionIds.add(report.session.sessionId);
    aggregateCounts(eventCounts, report.eventCounts);
    aggregateCounts(toolCounts, report.tools.counts);
    aggregateTokens(tokens, report.tokens);

    for (const [category, count] of Object.entries(report.errorCategories)) {
      const existing = errorMap.get(category) ?? { category, count: 0, files: new Set<string>() };
      existing.count += count;
      existing.files.add(displayPath);
      errorMap.set(category, existing);
    }
    for (const duplicate of report.tools.duplicateSignatures) {
      const existing = duplicateMap.get(duplicate.signature) ?? {
        signature: duplicate.signature,
        count: 0,
        tool: duplicate.tool,
        files: new Set<string>(),
      };
      existing.count += duplicate.count;
      existing.files.add(displayPath);
      duplicateMap.set(duplicate.signature, existing);
    }
    for (const message of report.anomalies) {
      anomalies.push({
        severity: rankSeverity(message, report),
        score: rankScore(message, report),
        file: displayPath,
        message,
      });
    }
  }

  totals.sessionsIncluded = sessionIds.size;

  const duplicateSignatures = [...duplicateMap.values()]
    .sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool))
    .map((item) => ({
      signature: item.signature,
      count: item.count,
      tool: item.tool,
      files: [...item.files].sort(),
    }));

  const errorCategories = [...errorMap.values()]
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
    .map((item) => ({
      category: item.category,
      count: item.count,
      files: [...item.files].sort(),
    }));

  const rankedAnomalies = anomalies
    .sort((a, b) => b.score - a.score || (a.file ?? '').localeCompare(b.file ?? '') || a.message.localeCompare(b.message))
    .slice(0, MAX_RANKED_ANOMALIES)
    .map((item, index) => ({ rank: index + 1, ...item }));
  const sufficientForSummary = totals.filesIncluded > 0;
  const sufficientForCompletionAssessment =
    sufficientForSummary && totals.incompleteLogs === 0;
  const hasFailureSignals = totals.failedToolCalls > 0 || errorCategories.length > 0;
  const sufficientForRootCause = !hasFailureSignals || rankedAnomalies.length > 0;
  const missingEvidenceFor = [
    !sufficientForSummary ? 'summary' : undefined,
    !sufficientForCompletionAssessment ? 'completion assessment' : undefined,
    !sufficientForRootCause ? 'root cause' : undefined,
  ].filter((value): value is string => Boolean(value));
  const evidenceSufficiency = {
    sufficientForInventory: names.length > 0,
    sufficientForSummary,
    sufficientForCompletionAssessment,
    sufficientForRootCause,
    missingEvidenceFor,
    followupBudget: missingEvidenceFor.length > 0 ? 1 : 0,
  };

  return {
    directory: {
      path: displayDirectory,
      absolutePath: dir,
    },
    files: files.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path)),
    totals,
    eventCounts,
    tokens,
    tools: {
      counts: toolCounts,
      duplicateSignatures,
    },
    errorCategories,
    rankedAnomalies,
    evidenceSufficiency,
    hasEnoughEvidence: sufficientForSummary,
  };
}

function buildInclusionReason(input: {
  active: boolean;
  incomplete: boolean;
  truncated: boolean;
  included: boolean;
}): string {
  if (input.included && input.active) return 'included: active session explicitly included';
  if (input.included && (input.incomplete || input.truncated)) return 'included: incomplete/truncated logs explicitly included';
  if (input.included) return 'included: complete session log';
  if (input.active) return 'excluded: active session log';
  if (input.truncated) return 'excluded: truncated or malformed log';
  if (input.incomplete) return 'excluded: incomplete log missing terminal events';
  return 'excluded';
}

function aggregateCounts(target: Record<string, number>, source: Record<string, number>): void {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + value;
  }
}

function aggregateTokens(target: JsonlTokenMetrics, source: JsonlTokenMetrics): void {
  target.modelCalls += source.modelCalls;
  target.inputTotal += source.inputTotal;
  target.outputTotal += source.outputTotal;
  target.cachedInputTotal += source.cachedInputTotal;
  target.maxInputPerCall = Math.max(target.maxInputPerCall, source.maxInputPerCall);
  target.cumulativeTotal = Math.max(target.cumulativeTotal, source.cumulativeTotal);
}

function rankSeverity(message: string, report: JsonlAnalysisReport): 'high' | 'medium' | 'low' {
  if (report.session.completionStatus === 'truncated' || /parse|truncated/i.test(message)) return 'high';
  if (report.tools.failedCount > 0 || /failed|error|hadError=true/i.test(message)) return 'medium';
  return 'low';
}

function rankScore(message: string, report: JsonlAnalysisReport): number {
  if (report.session.completionStatus === 'truncated' || /parse|truncated/i.test(message)) return 95;
  if (report.tools.failedCount > 0) return 75 + Math.min(report.tools.failedCount, 10);
  if (/Repeated tool signature/i.test(message)) return 65;
  if (/Token accounting/i.test(message)) return 55;
  return 40;
}
