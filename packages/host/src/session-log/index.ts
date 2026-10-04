/**
 * Live append-only session JSONL under `.mitii/logs/` (Desktop / VS Code / CLI).
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
