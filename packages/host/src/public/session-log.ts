/** Session log — Desktop/VS Code/CLI parity JSONL under `.mitii/logs`. */

export {
  appendSessionLog,
  buildShareableDiagnostic,
  createMitiiThreadSessionId,
  findLatestModelIoLog,
  findLatestSessionJsonl,
  findLatestSessionLog,
  formatMitiiLogStamp,
  getActiveModelIoSink,
  isModelIoLoggingEnabled,
  LoggingLlmPort,
  MITII_LOG_STAMP_PREFIX,
  openModelIoLog,
  openSessionLog,
  resolveMitiiSessionLogsDir,
  resolveSessionLogTextLimits,
  setActiveModelIoSink,
  wrapLlmPortForModelIo,
  writeSessionExport,
  writeShareableDiagnostic,
} from '../session-log/index.js';
export type {
  ModelIoSink,
  SessionLogAppend,
  SessionLogOpenOptions,
  SessionLogTextLimits,
  SessionLogWriter,
  ShareableDiagnosticMeta,
  ShareableDiagnosticSources,
} from '../session-log/index.js';
