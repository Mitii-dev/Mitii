# Enterprise Edition

Enterprise code belongs under this tree and must be composed only by EE entrypoints. CE composition (`src/composition/ce`) must never import this folder — enforced by `test/architecture/target-boundaries.test.ts`. There is currently no separate CE/EE build; `src/node/cli.ts` imports EE features directly into one unified binary (no entitlement/license gating).

Current feature folders: `teams` (`TeamService`), `distributed-jobs` (`JobQueueService`), `parallel-agents` (`ParallelAgentRunner`, depends on the CE `task-board` feature), `telemetry-webhook` (`WebhookEmitter`, injected into `kernel/telemetry/SessionLogService` as a `WebhookSink` port by `adapters/vscode/ThunderController.ts` — CE code never imports this directly).

Not yet extracted (still config flags with no dedicated feature code): managed provider policy (`localProvidersOnly`), audit automation (auto-export/redaction), managed channels, managed MCP policy.
