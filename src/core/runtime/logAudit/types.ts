/** Deterministic JSONL / session-log analysis result shapes. */

export interface JsonlFileMeta {
  path: string;
  bytes: number;
  lines: number;
}

export interface JsonlSessionMeta {
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  model?: string;
  mode?: string;
  sessionId?: string;
  hadError?: boolean;
  completed?: boolean;
  completionStatus?: 'complete' | 'incomplete' | 'truncated';
  completionReason?: string;
  lastEventType?: string;
}

export interface JsonlTokenMetrics {
  modelCalls: number;
  inputTotal: number;
  outputTotal: number;
  /** Max per-call inputTokens (not cumulative). */
  maxInputPerCall: number;
  /** Max observed cumulative/turn total when present. */
  cumulativeTotal: number;
  cachedInputTotal: number;
}

export interface JsonlToolMetrics {
  counts: Record<string, number>;
  totalCalls: number;
  failedCount: number;
  skippedCount: number;
  failed: Array<{ line: number; tool: string; error?: string; summary: string }>;
  skipped: Array<{ line: number; tool: string; summary: string }>;
  duplicateSignatures: Array<{ signature: string; count: number; tool: string }>;
}

export interface JsonlContextMetrics {
  retrievedTokens: number;
  droppedItems: number;
  pinnedFiles: string[];
}

export interface JsonlEvidenceItem {
  line: number;
  time?: string;
  type: string;
  summary: string;
}

export interface JsonlAnalysisReport {
  file: JsonlFileMeta;
  session: JsonlSessionMeta;
  eventCounts: Record<string, number>;
  tokens: JsonlTokenMetrics;
  errorCategories: Record<string, number>;
  tools: JsonlToolMetrics;
  context: JsonlContextMetrics;
  anomalies: string[];
  evidence: JsonlEvidenceItem[];
  hasEnoughEvidence: boolean;
}

export interface LogDirectoryFileResult {
  path: string;
  bytes: number;
  lines: number;
  mtimeMs: number;
  included: boolean;
  reason: string;
  active: boolean;
  incomplete: boolean;
  truncated: boolean;
  sessionId?: string;
  startedAt?: string;
  endedAt?: string;
  mode?: string;
  model?: string;
  hadError?: boolean;
}

export interface LogDirectoryTotals {
  filesListed: number;
  filesIncluded: number;
  filesExcluded: number;
  bytesIncluded: number;
  linesIncluded: number;
  sessionsIncluded: number;
  incompleteLogs: number;
  truncatedLogs: number;
  activeLogs: number;
  toolCalls: number;
  failedToolCalls: number;
  skippedToolCalls: number;
}

export interface LogDirectoryAnalysisReport {
  directory: {
    path: string;
    absolutePath: string;
  };
  files: LogDirectoryFileResult[];
  totals: LogDirectoryTotals;
  eventCounts: Record<string, number>;
  tokens: JsonlTokenMetrics;
  tools: {
    counts: Record<string, number>;
    duplicateSignatures: Array<{ signature: string; count: number; tool: string; files: string[] }>;
  };
  errorCategories: Array<{ category: string; count: number; files: string[] }>;
  rankedAnomalies: Array<{ rank: number; severity: 'high' | 'medium' | 'low'; score: number; file?: string; message: string }>;
  hasEnoughEvidence: boolean;
}

export interface QueryLogEventsInput {
  path: string;
  filter?: {
    type?: string[];
    tool?: string;
    success?: boolean;
  };
  fields?: string[];
  limit?: number;
  maxChars?: number;
}

export interface QueryLogEventsResult {
  path: string;
  matched: number;
  returned: number;
  truncated: boolean;
  events: Array<Record<string, unknown>>;
}
