import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { packRunArtifacts } from '../artifacts/pack.js';
import { DeliveryBus } from '../delivery/bus.js';
import type { DeliverySender } from '../delivery/types.js';
import {
  buildIncidentFingerprint,
  formatIncidentIssueTitle,
} from '../incident/evidence.js';
import { prepareIncidentEvidence } from '../incident/prepare.js';
import { newId, resolveAutomationReportsDir } from '../paths.js';
import type { SqliteAutomationStore } from '../store/sqliteStore.js';
import type { AutomationSpecRecord } from '../types.js';
import type {
  AutomationExecuteResult,
  AutomationRunExecutor,
} from './types.js';

export interface ClaimRunnerOptions {
  store: SqliteAutomationStore;
  executor: AutomationRunExecutor;
  pollIntervalMs?: number;
  claimLeaseSeconds?: number;
  globalMaxConcurrency?: number;
  reportsDir?: string;
  deliverySender?: DeliverySender;
  onEvent?: (event: ClaimRunnerEvent) => void;
}

export type ClaimRunnerEvent =
  | { type: 'tick'; claimed: number; running: number }
  | {
      type: 'run_started';
      runId: string;
      specId: string;
      title: string;
    }
  | {
      type: 'run_finished';
      runId: string;
      specId: string;
      status: 'done' | 'failed' | 'cancelled';
      error?: string;
      reportPath?: string;
    }
  | { type: 'error'; message: string };

/**
 * Single claim/lease runner. Polls the store, claims due runs, executes via
 * the injected port, writes reports, and completes rows.
 */
export class ClaimRunner {
  private readonly store: SqliteAutomationStore;
  private readonly executor: AutomationRunExecutor;
  private readonly pollIntervalMs: number;
  private readonly claimLeaseSeconds: number;
  private readonly globalMaxConcurrency: number;
  private readonly reportsDir: string;
  private readonly deliveryBus: DeliveryBus;
  private readonly onEvent?: (event: ClaimRunnerEvent) => void;
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private inFlight = 0;

  constructor(options: ClaimRunnerOptions) {
    this.store = options.store;
    this.executor = options.executor;
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
    this.claimLeaseSeconds = options.claimLeaseSeconds ?? 90;
    this.globalMaxConcurrency = options.globalMaxConcurrency ?? 4;
    this.reportsDir =
      options.reportsDir ?? resolveAutomationReportsDir(options.store.dbPath);
    this.deliveryBus = new DeliveryBus({
      store: options.store,
      sender: options.deliverySender,
    });
    this.onEvent = options.onEvent;
    mkdirSync(this.reportsDir, { recursive: true });
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    if (this.stopped) return;
    try {
      let claimed = 0;
      while (
        this.inFlight < this.globalMaxConcurrency &&
        this.store.countRunningGlobal() + this.inFlight <
          this.globalMaxConcurrency
      ) {
        const claimToken = newId('claim');
        const run = this.store.claimNextRun({
          claimToken,
          leaseSeconds: this.claimLeaseSeconds,
        });
        if (!run) break;
        const spec = this.store.getSpec(run.specId);
        if (!spec || !spec.prompt || !spec.workspaceRoot) {
          this.store.completeRun({
            runId: run.runId,
            claimToken,
            status: 'failed',
            error: 'Spec missing prompt or workspaceRoot',
          });
          continue;
        }
        claimed += 1;
        this.inFlight += 1;
        this.onEvent?.({
          type: 'run_started',
          runId: run.runId,
          specId: spec.specId,
          title: spec.title,
        });
        void this.executeClaimed(run.runId, claimToken, spec, run.triggerEventId).finally(() => {
          this.inFlight -= 1;
        });
      }
      this.onEvent?.({
        type: 'tick',
        claimed,
        running: this.store.countRunningGlobal(),
      });
    } catch (error) {
      this.onEvent?.({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async executeClaimed(
    runId: string,
    claimToken: string,
    spec: AutomationSpecRecord,
    triggerEventId: string | null,
  ): Promise<void> {
    const heartbeat = setInterval(() => {
      this.store.heartbeatClaim({
        runId,
        claimToken,
        leaseSeconds: this.claimLeaseSeconds,
      });
    }, Math.max(10_000, Math.floor(this.claimLeaseSeconds * 1000 * 0.4)));
    heartbeat.unref?.();

    const prompt = buildPromptWithEventContext({
      store: this.store,
      spec,
      triggerEventId,
    });

    let result: AutomationExecuteResult;
    try {
      result = await this.executor.execute({
        runId,
        specId: spec.specId,
        title: spec.title,
        prompt,
        workspaceRoot: spec.workspaceRoot!,
        mode: spec.mode ?? 'agent',
        autonomyPreset: spec.autonomyPreset ?? 'apply',
        timeoutSeconds: spec.timeoutSeconds ?? undefined,
      });
    } catch (error) {
      result = {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearInterval(heartbeat);
    }

    const reportPath = join(this.reportsDir, `${runId}.md`);
    const markdown =
      result.reportMarkdown ??
      defaultReport({
        runId,
        spec,
        result,
      });
    try {
      writeFileSync(reportPath, markdown, 'utf8');
    } catch {
      // report write failure should not block completion
    }

    this.store.completeRun({
      runId,
      claimToken,
      status: result.status,
      error: result.error ?? null,
      reportPath,
      sessionId: result.sessionId ?? null,
    });

    try {
      const run = this.store.getRun(runId);
      if (run) {
        let extraFiles: string[] | undefined;
        if (triggerEventId) {
          const event = this.store.getEventLog(triggerEventId);
          if (event && spec.workspaceRoot) {
            try {
              const prepared = prepareIncidentEvidence({
                dbPath: this.store.dbPath,
                runId,
                workspaceRoot: spec.workspaceRoot,
                event,
              });
              extraFiles = prepared.extraFiles;
            } catch {
              // CI log pull is best-effort
            }
          }
        }
        packRunArtifacts({
          run: { ...run, reportPath },
          spec,
          dbPath: this.store.dbPath,
          answer: result.answer,
          error: result.error,
          extraFiles,
        });
        const targets = DeliveryBus.targetsFromMetadataJson(spec.metadataJson);
        if (targets.length > 0) {
          this.deliveryBus.enqueueForRun({ runId, targets });
          void this.deliveryBus.flushPending();
        }
      }
    } catch {
      // artifact packing / delivery is best-effort
    }

    this.onEvent?.({
      type: 'run_finished',
      runId,
      specId: spec.specId,
      status: result.status,
      error: result.error,
      reportPath,
    });
  }
}

function buildPromptWithEventContext(input: {
  store: SqliteAutomationStore;
  spec: AutomationSpecRecord;
  triggerEventId: string | null;
}): string {
  const base = input.spec.prompt!;
  if (!input.triggerEventId) return base;
  const event = input.store.getEventLog(input.triggerEventId);
  if (!event) return base;
  const attrs = event.attributesJson ?? '{}';
  const payloadPreview = (event.payloadJson ?? '').slice(0, 8_000);

  let incidentHint = '';
  if (
    event.eventType.includes('workflow_run') ||
    event.eventType.includes('check_')
  ) {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = event.attributesJson
        ? (JSON.parse(event.attributesJson) as Record<string, unknown>)
        : {};
    } catch {
      parsed = {};
    }
    const repository =
      typeof parsed.repository === 'string' ? parsed.repository : undefined;
    const workflowName =
      typeof parsed.workflowName === 'string' ? parsed.workflowName : undefined;
    const conclusion =
      typeof parsed.conclusion === 'string' ? parsed.conclusion : undefined;
    const workflowRunId =
      typeof parsed.workflowRunId === 'string'
        ? parsed.workflowRunId
        : undefined;
    const fingerprint = buildIncidentFingerprint([
      event.eventType,
      repository ?? '',
      workflowName ?? '',
      workflowRunId ?? event.dedupeKey ?? event.eventId,
      conclusion ?? '',
    ]);
    const title = formatIncidentIssueTitle({
      fingerprint,
      workflowName,
      repository,
      conclusion,
    });
    incidentHint = `

## Suggested ticket (idempotent)
- title: ${title}
- fingerprint: ${fingerprint}
- Prefer \`create_github_issue\` with this title so duplicates stay searchable.
`;
  }

  return `${base}

---
## Trigger event
- eventId: ${event.eventId}
- eventType: ${event.eventType}
- source: ${event.source}
- subject: ${event.subject ?? '-'}
- occurredAt: ${event.occurredAt}
- attributes: ${attrs}
${incidentHint}
### Payload (truncated)
\`\`\`json
${payloadPreview || '{}'}
\`\`\`
`;
}

function defaultReport(input: {
  runId: string;
  spec: AutomationSpecRecord;
  result: AutomationExecuteResult;
}): string {
  const { runId, spec, result } = input;
  return `# Automation run ${runId}

- **Spec:** ${spec.title} (\`${spec.specId}\`)
- **Status:** ${result.status}
- **Workspace:** ${spec.workspaceRoot ?? 'n/a'}
- **Mode:** ${spec.mode ?? 'agent'}
- **Autonomy:** ${spec.autonomyPreset ?? 'apply'}

## Error

${result.error ?? '_none_'}

## Answer

${result.answer ?? '_none_'}
`;
}
