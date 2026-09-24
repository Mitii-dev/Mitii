/**
 * Desktop automations control plane — mirrors apps/vscode/src/automationHost.ts
 * without importing the VS Code app. Extended for enterprise flow CRUD + runner.
 *
 * Architecture: apps/desktop → @mitii/automation + @mitii/host (no apps/*).
 */

import type { AutomationEventEnvelope } from '@mitii/automation';

import {
  flowFromSpecRecord,
  type AutomationFlowDocument,
} from '../../shared/automations/flow.js';
import {
  AUTOMATION_TEMPLATES,
  getAutomationTemplate,
} from '../../shared/automations/templates.js';
import { desktopAutomationRuntime } from './runtime.js';
import {
  flowFilePath,
  removeFlowSpecFile,
  writeFlowSpecFile,
} from './specFiles.js';
import { readRunLog, writeRunLog } from './runLog.js';
import { readReportFile } from './steps.js';
import {
  getGitCommitHookStatus,
  installGitCommitHook,
  uninstallGitCommitHook,
} from './gitCommitHook.js';
import {
  readDesktopRunnerPrefs,
  readDesktopRunnerSecrets,
  writeDesktopRunnerConfig,
} from './runnerPrefs.js';

export interface AutomationSpecView {
  specId: string;
  externalId: string;
  title: string;
  enabled: boolean;
  triggerKind: string;
  scheduleExpr: string | null;
  eventType: string | null;
  nextRunAt: string | null;
  autonomyPreset: string | null;
  mode: string | null;
  sourcePath: string | null;
  prompt: string | null;
  metadataJson: string | null;
  filtersJson: string | null;
  timezone: string | null;
  debounceSeconds: number | null;
  dedupeWindowSeconds: number | null;
  cooldownSeconds: number | null;
  timeoutSeconds: number | null;
  maxParallel: number | null;
}

export interface AutomationRunView {
  runId: string;
  specId: string;
  status: string;
  triggerKind: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  reportPath: string | null;
  sessionId: string | null;
}

function mapSpec(spec: {
  specId: string;
  externalId: string;
  title: string;
  enabled: boolean;
  triggerKind: string;
  scheduleExpr: string | null;
  eventType: string | null;
  nextRunAt: string | null;
  autonomyPreset: string | null;
  mode: string | null;
  sourcePath: string;
  prompt: string | null;
  metadataJson: string | null;
  filtersJson: string | null;
  timezone: string | null;
  debounceSeconds: number | null;
  dedupeWindowSeconds: number | null;
  cooldownSeconds: number | null;
  timeoutSeconds: number | null;
  maxParallel: number | null;
}): AutomationSpecView {
  return {
    specId: spec.specId,
    externalId: spec.externalId,
    title: spec.title,
    enabled: spec.enabled,
    triggerKind: spec.triggerKind,
    scheduleExpr: spec.scheduleExpr,
    eventType: spec.eventType,
    nextRunAt: spec.nextRunAt,
    autonomyPreset: spec.autonomyPreset,
    mode: spec.mode,
    sourcePath: spec.sourcePath || null,
    prompt: spec.prompt,
    metadataJson: spec.metadataJson,
    filtersJson: spec.filtersJson,
    timezone: spec.timezone,
    debounceSeconds: spec.debounceSeconds,
    dedupeWindowSeconds: spec.dedupeWindowSeconds,
    cooldownSeconds: spec.cooldownSeconds,
    timeoutSeconds: spec.timeoutSeconds,
    maxParallel: spec.maxParallel,
  };
}

function mapRun(run: {
  runId: string;
  specId: string;
  status: string;
  triggerKind: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  reportPath: string | null;
  sessionId: string | null;
}): AutomationRunView {
  return {
    runId: run.runId,
    specId: run.specId,
    status: run.status,
    triggerKind: run.triggerKind,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    error: run.error,
    reportPath: run.reportPath,
    sessionId: run.sessionId,
  };
}

export interface AutomationsSnapshot {
  specs: AutomationSpecView[];
  runs: AutomationRunView[];
  runner: ReturnType<typeof desktopAutomationRuntime.getStatus>;
  stats: {
    specs: number;
    enabled: number;
    queued: number;
    running: number;
    done: number;
    failed: number;
  };
}

function snapshot(workspaceRoot: string | undefined): AutomationsSnapshot {
  return desktopAutomationRuntime.withService((service) => {
    if (workspaceRoot) {
      try {
        service.reconcileFiles({ workspaceRoot });
      } catch {
        /* ignore reconcile errors in UI */
      }
    }
    return {
      specs: service.listSchedules().map(mapSpec),
      runs: service.listRuns({ limit: 60 }).map(mapRun),
      runner: desktopAutomationRuntime.getStatus(),
      stats: service.stats(),
    };
  });
}

export function listDesktopAutomations(workspaceRoot: string | undefined) {
  return snapshot(workspaceRoot);
}

export async function triggerDesktopAutomation(
  workspaceRoot: string | undefined,
  specId: string,
) {
  if (workspaceRoot && !desktopAutomationRuntime.getStatus().running) {
    await desktopAutomationRuntime.start({ workspaceRoot });
  }
  return desktopAutomationRuntime.withService((service) => {
    if (workspaceRoot) {
      try {
        service.reconcileFiles({ workspaceRoot });
      } catch {
        /* ignore */
      }
    }
    const run = service.trigger(specId);
    if (workspaceRoot) {
      try {
        writeRunLog(workspaceRoot, {
          runId: run.runId,
          nodes: { trigger: 'queued' },
          lines: [
            {
              at: new Date().toISOString(),
              text: 'Trigger accepted',
              tone: 'info',
            },
          ],
        });
      } catch {
        /* live log is best-effort */
      }
    }
    return { ...snapshot(workspaceRoot), triggeredRunId: run.runId };
  });
}

export function pauseDesktopAutomation(
  workspaceRoot: string | undefined,
  specId: string,
) {
  return desktopAutomationRuntime.withService((service) => {
    service.pause(specId);
    return snapshot(workspaceRoot);
  });
}

export function resumeDesktopAutomation(
  workspaceRoot: string | undefined,
  specId: string,
) {
  return desktopAutomationRuntime.withService((service) => {
    service.resume(specId);
    return snapshot(workspaceRoot);
  });
}

export function deleteDesktopAutomation(
  workspaceRoot: string | undefined,
  specId: string,
) {
  return desktopAutomationRuntime.withService((service) => {
    const spec = service.getSchedule(specId);
    if (
      workspaceRoot &&
      spec?.sourcePath &&
      !spec.sourcePath.startsWith('api:')
    ) {
      try {
        removeFlowSpecFile(workspaceRoot, spec.sourcePath);
      } catch {
        /* ignore missing file */
      }
    }
    service.delete(specId);
    return snapshot(workspaceRoot);
  });
}

export function getDesktopAutomationFlow(
  workspaceRoot: string | undefined,
  specId: string,
): { flow: AutomationFlowDocument } {
  return desktopAutomationRuntime.withService((service) => {
    if (workspaceRoot) {
      try {
        service.reconcileFiles({ workspaceRoot });
      } catch {
        /* ignore */
      }
    }
    const spec = service.getSchedule(specId);
    if (!spec) {
      throw new Error(`Unknown automation: ${specId}`);
    }
    return {
      flow: flowFromSpecRecord({
        externalId: spec.externalId,
        title: spec.title,
        enabled: spec.enabled,
        triggerKind: spec.triggerKind,
        scheduleExpr: spec.scheduleExpr,
        timezone: spec.timezone,
        eventType: spec.eventType,
        filtersJson: spec.filtersJson,
        debounceSeconds: spec.debounceSeconds,
        dedupeWindowSeconds: spec.dedupeWindowSeconds,
        cooldownSeconds: spec.cooldownSeconds,
        mode: spec.mode,
        autonomyPreset: spec.autonomyPreset,
        prompt: spec.prompt,
        timeoutSeconds: spec.timeoutSeconds,
        maxParallel: spec.maxParallel,
        metadataJson: spec.metadataJson,
        sourcePath: spec.sourcePath,
      }),
    };
  });
}

export function saveDesktopAutomationFlow(
  workspaceRoot: string,
  flow: AutomationFlowDocument,
): AutomationsSnapshot & { path: string } {
  if (!workspaceRoot.trim()) {
    throw new Error('workspaceRoot_required');
  }
  if (!flow.id.trim()) {
    throw new Error('flow.id_required');
  }
  if (!flow.agent.prompt.trim()) {
    throw new Error('agent.prompt_required');
  }

  // Remove prior path if trigger kind changed (cron ↔ event dir).
  const prior = desktopAutomationRuntime.withService((service) => {
    service.reconcileFiles({ workspaceRoot });
    return service
      .listSchedules()
      .find(
        (s) =>
          s.externalId === flow.id ||
          s.sourcePath.endsWith(`/${flow.id}.cron.md`) ||
          s.sourcePath.endsWith(`/${flow.id}.event.md`),
      );
  });
  if (prior?.sourcePath && !prior.sourcePath.startsWith('api:')) {
    const nextPath = flowFilePath(workspaceRoot, flow);
    if (prior.sourcePath !== nextPath) {
      try {
        removeFlowSpecFile(workspaceRoot, prior.sourcePath);
      } catch {
        /* ignore */
      }
    }
  }

  const { path } = writeFlowSpecFile(workspaceRoot, flow);
  const snap = snapshot(workspaceRoot);
  return { path, ...snap };
}

export function listDesktopAutomationTemplates(): Array<{
  id: string;
  title: string;
  description: string;
  category: string;
}> {
  return AUTOMATION_TEMPLATES.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    category: t.category,
  }));
}

export function applyDesktopAutomationTemplate(
  workspaceRoot: string,
  templateId: string,
) {
  const template = getAutomationTemplate(templateId);
  if (!template) {
    throw new Error(`Unknown template: ${templateId}`);
  }
  const flow = template.build();
  return saveDesktopAutomationFlow(workspaceRoot, flow);
}

export async function startDesktopAutomationRunner(options: {
  workspaceRoot: string;
  webhookPort?: number;
  webhookToken?: string;
  githubWebhookSecret?: string;
  forceEcho?: boolean;
}) {
  const runner = await desktopAutomationRuntime.start(options);
  return { ...snapshot(options.workspaceRoot), runner };
}

export function stopDesktopAutomationRunner(
  workspaceRoot: string | undefined,
) {
  const runner = desktopAutomationRuntime.stop();
  return { ...snapshot(workspaceRoot), runner };
}

export function getDesktopAutomationRunnerStatus() {
  return desktopAutomationRuntime.getStatus();
}

export function getDesktopAutomationRunDetail(runId: string): {
  run: AutomationRunView;
  spec: AutomationSpecView | null;
  reportMarkdown: string | null;
  deliveries: Array<{
    deliveryId: string;
    adapter: string;
    status: string;
    targetJson: string;
    error: string | null;
    attempts: number;
    createdAt: string;
    updatedAt: string;
  }>;
  triggerEvent: {
    eventId: string;
    eventType: string;
    source: string;
    subject: string | null;
    occurredAt: string;
    processingStatus: string;
    payloadJson: string | null;
  } | null;
  timeline: Array<{
    at: string;
    label: string;
    detail?: string;
    tone?: 'ok' | 'warn' | 'err' | 'info';
  }>;
  live: {
    nodes: Record<string, 'queued' | 'running' | 'done' | 'failed'>;
    lines: Array<{ at: string; text: string; tone?: 'info' | 'ok' | 'err' }>;
  } | null;
} {
  return desktopAutomationRuntime.withService((service) => {
    const run = service.store.getRun(runId);
    if (!run) {
      throw new Error(`Unknown run: ${runId}`);
    }
    const spec = service.getSchedule(run.specId);
    const deliveries = service.store.listDeliveries({ runId, limit: 50 });
    const triggerEvent = run.triggerEventId
      ? service.store.getEventLog(run.triggerEventId) ?? null
      : null;
    const reportMarkdown = readReportFile(run.reportPath);
    const live = readRunLog(spec?.workspaceRoot, run.runId);

    const timeline: Array<{
      at: string;
      label: string;
      detail?: string;
      tone?: 'ok' | 'warn' | 'err' | 'info';
    }> = [
      {
        at: run.createdAt,
        label: 'Queued',
        detail: `trigger=${run.triggerKind}`,
        tone: 'info',
      },
    ];
    if (run.startedAt) {
      timeline.push({
        at: run.startedAt,
        label: 'Started',
        tone: 'info',
      });
    }
    if (run.completedAt) {
      timeline.push({
        at: run.completedAt,
        label:
          run.status === 'done'
            ? 'Completed'
            : run.status === 'failed'
              ? 'Failed'
              : run.status,
        detail: run.error ?? undefined,
        tone:
          run.status === 'done'
            ? 'ok'
            : run.status === 'failed'
              ? 'err'
              : 'warn',
      });
    }
    for (const d of deliveries) {
      timeline.push({
        at: d.updatedAt,
        label: `Delivery ${d.adapter}`,
        detail: d.status + (d.error ? `: ${d.error}` : ''),
        tone:
          d.status === 'sent' ? 'ok' : d.status === 'failed' ? 'err' : 'info',
      });
    }
    timeline.sort((a, b) => a.at.localeCompare(b.at));

    return {
      run: mapRun(run),
      spec: spec ? mapSpec(spec) : null,
      reportMarkdown,
      deliveries: deliveries.map((d) => ({
        deliveryId: d.deliveryId,
        adapter: d.adapter,
        status: d.status,
        targetJson: d.targetJson,
        error: d.error,
        attempts: d.attempts,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      })),
      triggerEvent: triggerEvent
        ? {
            eventId: triggerEvent.eventId,
            eventType: triggerEvent.eventType,
            source: triggerEvent.source,
            subject: triggerEvent.subject,
            occurredAt: triggerEvent.occurredAt,
            processingStatus: triggerEvent.processingStatus,
            payloadJson: triggerEvent.payloadJson,
          }
        : null,
      timeline,
      live: live
        ? { nodes: live.nodes, lines: live.lines }
        : null,
    };
  });
}

export function listDesktopAutomationEvents(options?: { limit?: number }) {
  return desktopAutomationRuntime.withService((service) =>
    service.listEvents({ limit: options?.limit ?? 40 }).map((e) => ({
      eventId: e.eventId,
      eventType: e.eventType,
      source: e.source,
      subject: e.subject,
      occurredAt: e.occurredAt,
      processingStatus: e.processingStatus,
      matchedSpecCount: e.matchedSpecCount,
      queuedRunCount: e.queuedRunCount,
    })),
  );
}

export function ingestDesktopAutomationEvent(
  workspaceRoot: string | undefined,
  event: AutomationEventEnvelope,
) {
  return desktopAutomationRuntime.withService((service) => {
    if (workspaceRoot) {
      try {
        service.reconcileFiles({ workspaceRoot });
      } catch {
        /* ignore */
      }
    }
    const result = service.ingestEvent(event);
    return {
      result: {
        eventId: result.event.eventId,
        processingStatus: result.event.processingStatus,
        matchedSpecCount: result.matchedSpecs.length,
        queuedRunCount: result.queuedRuns.length,
        duplicate: result.duplicate,
      },
      ...snapshot(workspaceRoot),
    };
  });
}

export function exportDesktopAutomations(workspaceRoot: string | undefined) {
  return desktopAutomationRuntime.withService((service) => {
    if (workspaceRoot) {
      try {
        service.reconcileFiles({ workspaceRoot });
      } catch {
        /* ignore */
      }
    }
    return service.exportSpecs();
  });
}

export function importDesktopAutomations(
  workspaceRoot: string | undefined,
  payload: { specs: Array<Record<string, unknown>> },
) {
  return desktopAutomationRuntime.withService((service) => {
    const result = service.importSpecs(payload);
    return { ...result, ...snapshot(workspaceRoot) };
  });
}

export function cancelDesktopAutomationRun(
  workspaceRoot: string | undefined,
  runId: string,
) {
  return desktopAutomationRuntime.withService((service) => {
    service.cancelRun(runId);
    return snapshot(workspaceRoot);
  });
}

export function getDesktopGitCommitHookStatus(workspaceRoot: string) {
  return getGitCommitHookStatus(workspaceRoot);
}

export function installDesktopGitCommitHook(input: {
  workspaceRoot: string;
  eventsUrl?: string | null;
  webhookToken?: string | null;
}) {
  const status = installGitCommitHook(input);
  return { hook: status, ...snapshot(input.workspaceRoot) };
}

export function uninstallDesktopGitCommitHook(workspaceRoot: string) {
  const status = uninstallGitCommitHook(workspaceRoot);
  return { hook: status, ...snapshot(workspaceRoot) };
}

export function getDesktopRunnerPrefs(workspaceRoot: string) {
  const prefs = readDesktopRunnerPrefs(workspaceRoot);
  const secrets = readDesktopRunnerSecrets(workspaceRoot);
  return {
    prefs,
    secrets: {
      webhookToken: secrets.webhookToken ?? '',
      githubWebhookSecret: secrets.githubWebhookSecret ?? '',
    },
  };
}

export function saveDesktopRunnerPrefs(input: {
  workspaceRoot: string;
  webhookPort: number;
  webhookToken?: string;
  githubWebhookSecret?: string;
}) {
  const prefs = writeDesktopRunnerConfig(input);
  return { prefs };
}
