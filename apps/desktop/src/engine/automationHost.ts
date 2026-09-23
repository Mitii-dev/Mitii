/**
 * Desktop automations control plane — mirrors apps/vscode/src/automationHost.ts
 * without importing the VS Code app.
 */

import { AutomationService } from '@mitii/automation';
import Database from 'better-sqlite3';

export interface AutomationSpecView {
  specId: string;
  title: string;
  enabled: boolean;
  triggerKind: string;
  scheduleExpr: string | null;
  eventType: string | null;
  nextRunAt: string | null;
  autonomyPreset: string | null;
}

export interface AutomationRunView {
  runId: string;
  specId: string;
  status: string;
  createdAt: string;
  error: string | null;
}

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

function openDatabase(
  filename: string,
  openOptions?: { readonly?: boolean; fileMustExist?: boolean },
): Database.Database {
  return new Database(filename, openOptions);
}

function withService<T>(fn: (service: AutomationService) => T): T {
  const service = new AutomationService({
    openDatabase: openDatabase as never,
  });
  try {
    return fn(service);
  } finally {
    try {
      service.close();
    } catch {
      /* ignore */
    }
  }
}

export function listDesktopAutomations(workspaceRoot: string | undefined): {
  specs: AutomationSpecView[];
  runs: AutomationRunView[];
} {
  return withService((service) => {
    if (workspaceRoot) {
      try {
        service.reconcileFiles({ workspaceRoot });
      } catch {
        /* ignore reconcile errors in UI */
      }
    }
    return {
      specs: service.listSchedules().map(mapSpec),
      runs: service.listRuns({ limit: 40 }).map(mapRun),
    };
  });
}

export function triggerDesktopAutomation(
  workspaceRoot: string | undefined,
  specId: string,
): { specs: AutomationSpecView[]; runs: AutomationRunView[] } {
  return withService((service) => {
    if (workspaceRoot) {
      try {
        service.reconcileFiles({ workspaceRoot });
      } catch {
        /* ignore */
      }
    }
    service.trigger(specId);
    return {
      specs: service.listSchedules().map(mapSpec),
      runs: service.listRuns({ limit: 40 }).map(mapRun),
    };
  });
}

export function pauseDesktopAutomation(
  _workspaceRoot: string | undefined,
  specId: string,
): { specs: AutomationSpecView[]; runs: AutomationRunView[] } {
  return withService((service) => {
    service.pause(specId);
    return {
      specs: service.listSchedules().map(mapSpec),
      runs: service.listRuns({ limit: 40 }).map(mapRun),
    };
  });
}

export function resumeDesktopAutomation(
  _workspaceRoot: string | undefined,
  specId: string,
): { specs: AutomationSpecView[]; runs: AutomationRunView[] } {
  return withService((service) => {
    service.resume(specId);
    return {
      specs: service.listSchedules().map(mapSpec),
      runs: service.listRuns({ limit: 40 }).map(mapRun),
    };
  });
}
