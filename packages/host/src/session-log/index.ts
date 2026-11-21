/**
 * Live append-only session JSONL, model I/O JSONL, and shareable diagnostics
 * under `.mitii/logs/` (Desktop / VS Code / CLI).
 */

export {
  formatMitiiLogStamp,
  MITII_LOG_STAMP_PREFIX,
} from './mitiiLogStamp.js';
export { createMitiiThreadSessionId } from './threadSessionId.js';
export {
  appendSessionLog,
  findLatestSessionLog,
  openSessionLog,
  resolveMitiiSessionLogsDir,
  resolveSessionLogTextLimits,
  writeSessionExport,
} from './sessionLog.js';
export type {
  SessionLogAppend,
  SessionLogOpenOptions,
  SessionLogTextLimits,
  SessionLogWriter,
} from './sessionLog.js';
export {
  findLatestModelIoLog,
  getActiveModelIoSink,
  isModelIoLoggingEnabled,
  LoggingLlmPort,
  openModelIoLog,
  setActiveModelIoSink,
  wrapLlmPortForModelIo,
} from './modelIoLog.js';
export type { ModelIoSink } from './modelIoLog.js';
export {
  buildShareableDiagnostic,
  findLatestSessionJsonl,
  writeShareableDiagnostic,
} from './shareableDiagnostic.js';
export type {
  ShareableDiagnosticMeta,
  ShareableDiagnosticSources,
} from './shareableDiagnostic.js';
