import type * as vscode from 'vscode';

import type { RunBudgetSettingsSnapshot } from '../protocol.js';
import { resolveEffectiveContextWindow } from '../settingsFields.js';

export const DEFAULT_RUN_BUDGET: RunBudgetSettingsSnapshot = {
  unlimited: false,
  maxModelCalls: 64,
  maxToolCalls: 128,
  maxLoopIterations: 96,
  maxWallTimeMinutes: 30,
};

export function readRunBudgetSettings(vs: typeof vscode): RunBudgetSettingsSnapshot {
  const cfg = vs.workspace.getConfiguration('mitii');
  const readPositive = (
    key: string,
    fallback: number,
    minimum: number,
  ): number => {
    const value = cfg.get<number>(key);
    if (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= minimum
    ) {
      return Math.floor(value);
    }
    return fallback;
  };
  return {
    unlimited: cfg.get<boolean>('runBudget.unlimited') ?? false,
    maxModelCalls: readPositive(
      'runBudget.maxModelCalls',
      DEFAULT_RUN_BUDGET.maxModelCalls,
      1,
    ),
    maxToolCalls: readPositive(
      'runBudget.maxToolCalls',
      DEFAULT_RUN_BUDGET.maxToolCalls,
      1,
    ),
    maxLoopIterations: readPositive(
      'runBudget.maxLoopIterations',
      DEFAULT_RUN_BUDGET.maxLoopIterations,
      1,
    ),
    maxWallTimeMinutes: readPositive(
      'runBudget.maxWallTimeMinutes',
      DEFAULT_RUN_BUDGET.maxWallTimeMinutes,
      1,
    ),
  };
}

export function readMaximumIndexFiles(vs: typeof vscode): number {
  const value = vs.workspace
    .getConfiguration('mitii')
    .get<number>('workspace.maximumIndexFiles');
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(240_000, Math.floor(value)));
}

export function configValuesEqual(current: unknown, next: unknown): boolean {
  if (Object.is(current, next)) return true;
  if (
    typeof current === 'number' &&
    typeof next === 'number' &&
    Number.isFinite(current) &&
    Number.isFinite(next)
  ) {
    return current === next;
  }
  if (typeof current === 'string' && typeof next === 'string') {
    return current === next;
  }
  if (typeof current === 'boolean' && typeof next === 'boolean') {
    return current === next;
  }
  return false;
}

export function resolveContextWindow(vs: typeof vscode): number {
  const cfg = vs.workspace.getConfiguration('mitii');
  const fromSetting = cfg.get<number>('provider.contextWindow');
  const stored =
    typeof fromSetting === 'number' && Number.isFinite(fromSetting)
      ? Math.floor(fromSetting)
      : 0;
  const model = cfg.get<string>('provider.model') ?? '';
  const providerType = cfg.get<string>('provider.type') ?? '';
  return resolveEffectiveContextWindow(stored, model, providerType);
}
