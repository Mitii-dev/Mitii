import { resolve } from 'node:path';

import { getNextCronIso, validateCronPattern } from './cron/next.js';
import { EventIngress } from './events/ingress.js';
import type {
  AutomationEventEnvelope,
  EventIngressResult,
} from './events/types.js';
import {
  enqueueManualTrigger,
  materializeDueRuns,
} from './materializer.js';
import {
  newId,
  resolveAutomationDbPath,
  resolveWorkspaceCronDir,
} from './paths.js';
import { ClaimRunner, type ClaimRunnerEvent } from './runner/claimRunner.js';
import type { AutomationRunExecutor } from './runner/types.js';
import { reconcileCronSpecsDir } from './specs/reconciler.js';
import { SqliteAutomationStore } from './store/sqliteStore.js';
import {
  createScheduleInputSchema,
  type AutomationRunRecord,
  type AutomationServeOptions,
  type AutomationSpecRecord,
  type CreateScheduleInput,
  type ListRunsOptions,
  type ListSpecsOptions,
} from './types.js';
import {
  startAutomationWebhookServer,
  type AutomationWebhookServer,
} from './webhook/server.js';

export interface AutomationServiceOptions {
  dbPath?: string;
  executor?: AutomationRunExecutor;
  pollIntervalMs?: number;
  claimLeaseSeconds?: number;
  globalMaxConcurrency?: number;
  deliverySender?: import('./delivery/types.js').DeliverySender;
  onEvent?: (event: ClaimRunnerEvent) => void;
}

/**
 * Façade for schedule CRUD + optional serve loop (materialize + claim runner).
 */
export class AutomationService {
  readonly store: SqliteAutomationStore;
  private runner: ClaimRunner | null = null;
  private materializeTimer: NodeJS.Timeout | null = null;
  private webhook: AutomationWebhookServer | null = null;
  private readonly options: AutomationServiceOptions;
  private readonly ingress: EventIngress;

  constructor(options: AutomationServiceOptions = {}) {
    const dbPath = resolveAutomationDbPath({ dbPath: options.dbPath });
    this.store = new SqliteAutomationStore(dbPath);
    this.options = options;
    this.ingress = new EventIngress({ store: this.store });
  }

  close(): void {
    this.stop();
    this.store.close();
  }

  ingestEvent(event: AutomationEventEnvelope): EventIngressResult {
    return this.ingress.ingestEvent(event);
  }

  listEvents(options?: { limit?: number }) {
    return this.store.listEventLogs(options);
  }

  /** Phase 5 — export enabled specs as portable JSON (no run history). */
  exportSpecs(): {
    schemaVersion: 1;
    exportedAt: string;
    specs: Array<Record<string, unknown>>;
  } {
    const specs = this.store.listSpecs({ includeRemoved: false });
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      specs: specs.map((s) => ({
        externalId: s.externalId,
        title: s.title,
        triggerKind: s.triggerKind,
        enabled: s.enabled,
        prompt: s.prompt,
        workspaceRoot: s.workspaceRoot,
        scheduleExpr: s.scheduleExpr,
        timezone: s.timezone,
        eventType: s.eventType,
        filtersJson: s.filtersJson,
        debounceSeconds: s.debounceSeconds,
        dedupeWindowSeconds: s.dedupeWindowSeconds,
        cooldownSeconds: s.cooldownSeconds,
        mode: s.mode,
        autonomyPreset: s.autonomyPreset,
        timeoutSeconds: s.timeoutSeconds,
        maxParallel: s.maxParallel,
        tagsJson: s.tagsJson,
        metadataJson: s.metadataJson,
      })),
    };
  }

  /** Phase 5 — import specs from exportSpecs() JSON (idempotent by externalId). */
  importSpecs(payload: {
    specs: Array<Record<string, unknown>>;
  }): { upserted: number } {
    let upserted = 0;
    for (const raw of payload.specs) {
      const externalId = String(raw.externalId ?? raw.title ?? '');
      if (!externalId) continue;
      const existing = this.store
        .listSpecs({ includeRemoved: true })
        .find((s) => s.externalId === externalId);
      const specId = existing?.specId ?? newId('spec');
      this.store.upsertSpec({
        specId,
        externalId,
        sourcePath: existing?.sourcePath ?? `api:import:${externalId}`,
        triggerKind: (raw.triggerKind as AutomationSpecRecord['triggerKind']) ?? 'manual',
        parseStatus: 'valid',
        enabled: raw.enabled !== false,
        title: String(raw.title ?? externalId),
        prompt: raw.prompt == null ? null : String(raw.prompt),
        workspaceRoot:
          raw.workspaceRoot == null ? null : String(raw.workspaceRoot),
        scheduleExpr:
          raw.scheduleExpr == null ? null : String(raw.scheduleExpr),
        timezone: raw.timezone == null ? null : String(raw.timezone),
        eventType: raw.eventType == null ? null : String(raw.eventType),
        filtersJson: raw.filtersJson == null ? null : String(raw.filtersJson),
        debounceSeconds:
          typeof raw.debounceSeconds === 'number' ? raw.debounceSeconds : null,
        dedupeWindowSeconds:
          typeof raw.dedupeWindowSeconds === 'number'
            ? raw.dedupeWindowSeconds
            : null,
        cooldownSeconds:
          typeof raw.cooldownSeconds === 'number' ? raw.cooldownSeconds : null,
        mode: (raw.mode as AutomationSpecRecord['mode']) ?? null,
        autonomyPreset:
          (raw.autonomyPreset as AutomationSpecRecord['autonomyPreset']) ??
          null,
        timeoutSeconds:
          typeof raw.timeoutSeconds === 'number' ? raw.timeoutSeconds : null,
        maxParallel:
          typeof raw.maxParallel === 'number' ? raw.maxParallel : null,
        tagsJson: raw.tagsJson == null ? null : String(raw.tagsJson),
        metadataJson:
          raw.metadataJson == null ? null : String(raw.metadataJson),
        source: 'api',
        bumpRevision: Boolean(existing),
      });
      upserted += 1;
    }
    return { upserted };
  }

  createSchedule(input: CreateScheduleInput): AutomationSpecRecord {
    const parsed = createScheduleInputSchema.parse(input);
    validateCronPattern(parsed.cron!);
    const workspaceRoot = resolve(parsed.workspaceRoot);
    const specId = newId('spec');
    const nextRunAt = getNextCronIso(
      parsed.cron!,
      Date.now(),
      parsed.timezone,
    );
    return this.store.upsertSpec({
      specId,
      externalId: specId,
      sourcePath: `api:schedule:${specId}`,
      triggerKind: 'schedule',
      parseStatus: 'valid',
      enabled: parsed.enabled ?? true,
      title: parsed.name,
      prompt: parsed.prompt,
      workspaceRoot,
      scheduleExpr: parsed.cron!,
      timezone: parsed.timezone ?? null,
      mode: parsed.mode ?? 'agent',
      autonomyPreset: parsed.autonomyPreset ?? 'apply',
      timeoutSeconds: parsed.timeoutSeconds ?? null,
      maxParallel: parsed.maxParallel ?? 1,
      source: 'api',
      tagsJson: parsed.tags ? JSON.stringify(parsed.tags) : null,
      metadataJson: parsed.metadata
        ? JSON.stringify(parsed.metadata)
        : null,
      nextRunAt,
    });
  }

  listSchedules(options?: ListSpecsOptions): AutomationSpecRecord[] {
    return this.store.listSpecs(options);
  }

  getSchedule(specId: string): AutomationSpecRecord | undefined {
    return this.store.getSpec(specId);
  }

  pause(specId: string): void {
    this.requireSpec(specId);
    this.store.setSpecEnabled(specId, false);
  }

  resume(specId: string): void {
    this.requireSpec(specId);
    this.store.setSpecEnabled(specId, true);
  }

  delete(specId: string): void {
    this.requireSpec(specId);
    this.store.cancelQueuedRunsForSpec(specId);
    this.store.deleteSpec(specId);
  }

  trigger(specId: string): AutomationRunRecord {
    const spec = this.requireSpec(specId);
    if (!spec.enabled) {
      throw new Error(`Spec "${spec.title}" is paused`);
    }
    return enqueueManualTrigger(this.store, spec);
  }

  listRuns(options?: ListRunsOptions): AutomationRunRecord[] {
    return this.store.listRuns(options);
  }

  stats(): {
    specs: number;
    enabled: number;
    queued: number;
    running: number;
    done: number;
    failed: number;
  } {
    const specs = this.store.listSpecs({ includeRemoved: false });
    const runs = this.store.listRuns({ limit: 500 });
    return {
      specs: specs.length,
      enabled: specs.filter((s) => s.enabled).length,
      queued: runs.filter((r) => r.status === 'queued').length,
      running: runs.filter((r) => r.status === 'running').length,
      done: runs.filter((r) => r.status === 'done').length,
      failed: runs.filter((r) => r.status === 'failed').length,
    };
  }

  upcoming(limit = 10): Array<{ specId: string; title: string; nextRunAt: string }> {
    return this.store
      .listSpecs({ enabledOnly: true })
      .filter((s) => s.triggerKind === 'schedule' && s.nextRunAt)
      .sort((a, b) => String(a.nextRunAt).localeCompare(String(b.nextRunAt)))
      .slice(0, limit)
      .map((s) => ({
        specId: s.specId,
        title: s.title,
        nextRunAt: s.nextRunAt!,
      }));
  }

  reconcileFiles(options: {
    workspaceRoot?: string;
    specsDir?: string;
  } = {}): ReturnType<typeof reconcileCronSpecsDir> {
    const workspaceRoot = options.workspaceRoot
      ? resolve(options.workspaceRoot)
      : process.cwd();
    const specsDir = options.specsDir ?? resolveWorkspaceCronDir(workspaceRoot);
    return reconcileCronSpecsDir(this.store, {
      specsDir,
      defaultWorkspaceRoot: workspaceRoot,
    });
  }

  materialize(): ReturnType<typeof materializeDueRuns> {
    return materializeDueRuns(this.store);
  }

  /**
   * Start materializer + claim runner. Requires an executor.
   */
  start(serve: AutomationServeOptions = {}): void {
    if (!this.options.executor) {
      throw new Error(
        'AutomationService.start requires an AutomationRunExecutor',
      );
    }
    if (serve.autoReconcile !== false && serve.workspaceRoot) {
      this.reconcileFiles({
        workspaceRoot: serve.workspaceRoot,
        specsDir: serve.specsDir,
      });
    }
    this.materialize();
    if (!this.runner) {
      this.runner = new ClaimRunner({
        store: this.store,
        executor: this.options.executor,
        pollIntervalMs: serve.pollIntervalMs ?? this.options.pollIntervalMs,
        claimLeaseSeconds:
          serve.claimLeaseSeconds ?? this.options.claimLeaseSeconds,
        globalMaxConcurrency:
          serve.globalMaxConcurrency ?? this.options.globalMaxConcurrency,
        deliverySender: this.options.deliverySender,
        onEvent: this.options.onEvent,
      });
    }
    this.runner.start();
    if (!this.materializeTimer) {
      const interval = serve.pollIntervalMs ?? this.options.pollIntervalMs ?? 5_000;
      this.materializeTimer = setInterval(() => {
        try {
          if (serve.autoReconcile !== false && serve.workspaceRoot) {
            this.reconcileFiles({
              workspaceRoot: serve.workspaceRoot,
              specsDir: serve.specsDir,
            });
          }
          this.materialize();
        } catch {
          // keep loop alive
        }
      }, interval);
      this.materializeTimer.unref?.();
    }
    if (serve.webhookPort && !this.webhook) {
      void startAutomationWebhookServer({
        service: this,
        port: serve.webhookPort,
        host: serve.webhookHost,
        token: serve.webhookToken,
        workspaceRoot: serve.workspaceRoot,
      }).then((server) => {
        this.webhook = server;
      });
    }
  }

  async startWebhook(options: {
    port: number;
    host?: string;
    token?: string;
    workspaceRoot?: string;
  }): Promise<string> {
    if (this.webhook) return this.webhook.url;
    this.webhook = await startAutomationWebhookServer({
      service: this,
      port: options.port,
      host: options.host,
      token: options.token,
      workspaceRoot: options.workspaceRoot,
    });
    return this.webhook.url;
  }

  stop(): void {
    this.runner?.stop();
    this.runner = null;
    if (this.materializeTimer) {
      clearInterval(this.materializeTimer);
      this.materializeTimer = null;
    }
    if (this.webhook) {
      void this.webhook.close();
      this.webhook = null;
    }
  }

  private requireSpec(specId: string): AutomationSpecRecord {
    const spec = this.store.getSpec(specId);
    if (!spec || spec.removed) {
      throw new Error(`Unknown schedule id: ${specId}`);
    }
    return spec;
  }
}
