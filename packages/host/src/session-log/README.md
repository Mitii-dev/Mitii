# Session log

Live append-only JSONL writer for Mitii runs under `.mitii/logs/` (or `MITII_LOGS_PATH`). Also owns model I/O logging and the shareable diagnostic export so Desktop, VS Code, and the CLI share one implementation.

## Responsibility

Persist a Desktop/VS Code–parity session timeline while a run is in progress (plus `*-model-io.jsonl` with secret redaction, and a redacted one-file diagnostic markdown):

- `run_start` when the log opens
- compacted `RunEvent` lines (skips noisy content/reasoning deltas)
- `warning` keeps `message` plus optional `code`, `stage`, and `data` for filterable diagnostics
- `plan_ready` keeps objective, stepCount, and capped `stepSummaries` (not the full plan body)
- `run_end` when the run terminates

Filenames: `MM-DD-YYYY-HH-MM-<sessionId>.jsonl` (often `thread_…`).

## Input / output

| | |
|---|---|
| **Input** | Workspace root, prompt/mode metadata, `runId` / `sessionId`, streaming `RunEvent`s, final `AgentRunResult` |
| **Output** | Append-only JSONL path; optional one-shot `session-export-*.json` |

## Ports

None. Uses Node `fs` only. Callers supply workspace root and optional `logsDir`.

## Exports

- `openSessionLog` / `appendSessionLog` / `writeSessionExport` / `findLatestSessionLog`
- `resolveMitiiSessionLogsDir` / `resolveSessionLogTextLimits`
- `formatMitiiLogStamp` / `MITII_LOG_STAMP_PREFIX` / `createMitiiThreadSessionId`
- `openModelIoLog` / `findLatestModelIoLog` / `wrapLlmPortForModelIo` / `LoggingLlmPort` / `setActiveModelIoSink` / `isModelIoLoggingEnabled`
- `writeShareableDiagnostic` / `buildShareableDiagnostic` / `findLatestSessionJsonl`

## Failure modes

- Missing workspace root → no writer (`undefined`)
- Disk errors on append are not swallowed; hosts should treat logging as best-effort at the call site if needed

## Non-responsibilities

- Deciding when model I/O logging is enabled (hosts read their own settings)
- CLI/VS Code/Desktop UI rendering of events
