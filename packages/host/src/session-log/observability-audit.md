# Logging audit

Open a session JSONL for the run timeline and its matching `*-model-io.jsonl` for the model exchanges. The timeline already records stage transitions, decisions, warnings, tool outcomes, verification and terminal state. Keep those records and add details at the boundaries below when a choice, failure or fallback would otherwise be invisible. Use a single summary per stage or batch with an extra event for actionable failures or degraded operation.

## Agent run

| Priority | Boundary | Diagnostic details to add |
|---|---|---|
| High | Request intake and classification in `request-intake`, `request-understanding` and `executeStartEarlyPipeline.ts` | Record selected intent, effective mode, classifier source, fallback reason and duration. Carry run identity into the classifier call, which currently calls the provider without context. |
| High | Context and prompts in `executeStartEnrichment*.ts`, `prepareTurn.ts`, `prompt-construction` and `window-budget` | Record which contributors supplied context, counts and token estimates before and after budgeting, and why sections were omitted. Include history compaction, repository retrieval, editor input, memory, skills, rules and plan state. Keep the actual assembled messages in the model snapshot. |
| High | Model transports in `modules/model-gateway` | Record provider attempt number, effective model, stream handshake or first-token latency, retry reason and ignored malformed frame counts. The host snapshot captures the shared request and event stream before provider-specific serialization and cannot expose internal attempts. |
| High | Tool dispatch and permissions in `settleTools.ts`, `settleToolsGrantExpansion.ts`, `executeTool.ts` and `tool-runtime` | Record call ID and tool name, argument validation failure category, policy or approval rule, sandbox backend, timeout or exit status, and result compaction counts. Summarize parallel batches, retries, and deferred calls. |
| High | Verification in `verificationGate.ts`, `resolveVerificationImpactWiden.ts`, `verificationFinishFailed.ts` and `modules/verification` | Record checks chosen or skipped, their selection reason, baseline comparison, duration, usable diagnostic count and retry/escalation reason. Capture when impact analysis or manifest discovery fails and a narrower set of checks runs. |
| High | Lifecycle and checkpoints in `executeResume*.ts`, `executeRestore.ts`, `writeRestorePoint.ts` and SDK `run.ts` | Correlate start, suspend, resume and restore. Record checkpoint identity, stale or missing state, cancellation source and affected paths on partial restore. |
| Medium | Planning, policy, tasks and discovery in `planning`, `decision-policy`, `task-list` and `pinDiscoveryPass.ts` | Record strategy and gate outcomes, evidence or limits driving decisions, task state counts and reasons work was skipped, deduplicated or stopped early. `collectPlanningImpactReports.ts` can return without impact reports after an exception. |
| Medium | Change impact, repository context and code navigation in the V8 modules and host `repository-context`, `repository-graph` and `code-navigation` | Record index revision and age, candidate and accepted counts, graph confidence, incomplete edges, fallback source and why verification scope widened. Summarize workspace scans and graph walks. |
| Medium | Repository indexing in host `indexing` and V8 `repository-state` | Record cache hit or rebuild reason, fingerprint changes, lock wait, migration/recovery result, skipped file counts and parse/embedding failure counts. Include backend and duration. |
| Medium | Memory, skills and review in the corresponding V8 modules | Record retrieval backend and fallback, candidate and accepted counts, memory-read/write failure categories, skill filtering, and finding repair or reflection failures. Examples include `RetrieveMemory.ts`, `RepairFindingArgs.ts` and `ReflectFindings.ts`. |

## Hosts and background work

| Priority | Boundary | Diagnostic details to add |
|---|---|---|
| High | VS Code `hostAsk.ts`, Desktop `engine/chat/streamRun.ts`, and host `session-log` | Replace the process-wide model sink with run-scoped ownership so overlapping requests cannot write to the wrong session. Surface logging setup and write failures without masking the run outcome. Include session, run and request IDs where available. |
| High | CLI `session.ts` and `ports.ts`, daemon and ACP `main.ts` | Extend model snapshot coverage to these entry points. Record run/configuration failures, client disconnects and cancellation using the same correlation fields. Keep protocol output separate from diagnostics. |
| Medium | VS Code sidebar and autocomplete, Desktop routes and explorer, shared host config/start/ports | Record host request outcome, runtime readiness, provider/profile selection, missing capabilities, failed settings/storage operations, file watcher recovery, and failed host prompt or editor context collection. Autocomplete has a separate FIM client and needs its own coverage. |
| Medium | `packages/mcp`, host sandbox, and external connectors/search | Record connection, discovery and invocation outcome, server or backend identity, timeout/retry/fallback and affected capability. Avoid logging transport credentials, environment values or complete responses. |
| Medium | `packages/automation` service, runner, store and delivery | Correlate schedule or webhook trigger with the launched run. Record skip/deduplication reason, artifact persistence and delivery attempt results. |

## Model snapshot format

The host writes `model_snapshot` once per observed call when the stream exits. It combines the sanitized assembled request, offered tool metadata, collected text and tool calls, timing, usage and finish/error information. A user message can trigger multiple model calls through classification, tool execution, planning and verification. Each observed exchange gets its own record and shares a run ID where the caller supplies it. The run timeline records what happened between calls.

The snapshot uses the existing redaction rules and size limits. Large inputs and outputs can be clipped, tool schemas are summarized, and provider-specific wire data is outside the capture point. An abrupt process exit before the stream closes can leave no snapshot for that call. The log viewer and shareable diagnostic export still accept the earlier two-record format.
