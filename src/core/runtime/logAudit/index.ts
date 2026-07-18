export type {
  JsonlAnalysisReport,
  JsonlEvidenceItem,
  JsonlFileMeta,
  JsonlSessionMeta,
  JsonlTokenMetrics,
  JsonlToolMetrics,
  JsonlContextMetrics,
  LogDirectoryAnalysisReport,
  LogDirectoryFileResult,
  LogDirectoryTotals,
  QueryLogEventsInput,
  QueryLogEventsResult,
} from './types';

export { analyzeJsonlFile } from './analyzeJsonl';
export type { AnalyzeJsonlOptions } from './analyzeJsonl';
export { analyzeLogDirectory } from './analyzeLogDirectory';
export type { AnalyzeLogDirectoryOptions } from './analyzeLogDirectory';

export { queryLogEvents } from './queryLogEvents';

export {
  isLogAuditTask,
  extractLogAuditTargetPath,
  buildLogAuditBootstrapBlock,
  buildLogAuditBlockedToolMessage,
  LOG_AUDIT_ALLOWED_TOOLS,
  LOG_AUDIT_EXCLUDED_TOOLS,
  LOG_AUDIT_SKIP_RETRIEVAL_SOURCES,
  LOG_AUDIT_AGENT_MAX_STEPS,
  NO_TOOLS_LOG_AUDIT_NUDGE,
} from './routing';
