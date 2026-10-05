# Session log

Live append-only JSONL writer for Mitii runs under `.mitii/logs/` (or `MITII_LOGS_PATH`).

## Responsibility

Persist a Desktop/VS Code–parity session timeline while a run is in progress:

- `run_start` when the log opens
- compacted `RunEvent` lines (skips noisy content/reasoning deltas)
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

## Failure modes

- Missing workspace root → no writer (`undefined`)
- Disk errors on append are not swallowed; hosts should treat logging as best-effort at the call site if needed

## Non-responsibilities

- Model I/O body logging (`*-model-io.jsonl`)
- Shareable diagnostic markdown export
- CLI/VS Code/Desktop UI rendering of events
