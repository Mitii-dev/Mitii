import { AutomationService } from '@mitii/automation';

import type {
  AutomationRunView,
  AutomationSpecView,
  HostToWebviewMessage,
} from './protocol.js';

function mapSpec(spec: {
  specId: string;
  title: string;
  enabled: boolean;
  triggerKind: string;
  scheduleExpr: string | null;
  eventType: string | null;
  nextRunAt: string | null;
  autonomyPreset: string | null;
}): AutomationSpecView {
  return {
    specId: spec.specId,
    title: spec.title,
    enabled: spec.enabled,
    triggerKind: spec.triggerKind,
    scheduleExpr: spec.scheduleExpr,
    eventType: spec.eventType,
    nextRunAt: spec.nextRunAt,
    autonomyPreset: spec.autonomyPreset,
  };
}

function mapRun(run: {
  runId: string;
  specId: string;
  status: string;
  createdAt: string;
  error: string | null;
}): AutomationRunView {
  return {
    runId: run.runId,
    specId: run.specId,
    status: run.status,
    createdAt: run.createdAt,
    error: run.error,
  };
}

/**
 * Phase 5 — host helpers for Automations panel (shared SQLite control plane).
 */
export function handleAutomationHostMessage(input: {
  message:
    | { type: 'requestAutomations'; requestId: string }
    | { type: 'automation.trigger'; specId: string }
    | { type: 'automation.pause'; specId: string }
    | { type: 'automation.resume'; specId: string };
  post: (msg: HostToWebviewMessage) => void;
  workspaceRoot: string;
}): void {
  const service = new AutomationService({});
  try {
    if (input.message.type === 'requestAutomations') {
      // Reconcile workspace file specs so the panel mirrors `mitii serve`.
      try {
        service.reconcileFiles({ workspaceRoot: input.workspaceRoot });
      } catch {
        // ignore reconcile errors in UI
      }
      const specs = service.listSchedules().map(mapSpec);
      const runs = service.listRuns({ limit: 40 }).map(mapRun);
      input.post({
        type: 'automationsResult',
        requestId: input.message.requestId,
        specs,
        runs,
      });
      return;
    }
    if (input.message.type === 'automation.trigger') {
      service.trigger(input.message.specId);
    } else if (input.message.type === 'automation.pause') {
      service.pause(input.message.specId);
    } else if (input.message.type === 'automation.resume') {
      service.resume(input.message.specId);
    }
    const specs = service.listSchedules().map(mapSpec);
    const runs = service.listRuns({ limit: 40 }).map(mapRun);
    input.post({
      type: 'automationsResult',
      requestId: `after_${input.message.specId}`,
      specs,
      runs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (input.message.type === 'requestAutomations') {
      input.post({
        type: 'automationsResult',
        requestId: input.message.requestId,
        specs: [],
        runs: [],
        error: message,
      });
    }
  } finally {
    service.close();
  }
}
