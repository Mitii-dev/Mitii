import type * as vscode from 'vscode';

import type { RunBudgetSettingsSnapshot } from '../protocol.js';
import { LOOP_POLICY_FIELDS } from '../loopPolicySettings.js';
import { TOKEN_BUDGET_FIELDS } from '../tokenBudgetSettings.js';
import { V8_LOOP_POLICY_FIELDS } from '../v8LoopPolicySettings.js';
import type { SettingsSetMessage } from './settingsWriters.js';

export type ConfigUpdate = (key: string, value: unknown) => Promise<void>;

/** Persist the `ui` branch of a `settings.set` message through `update`. */
export async function applyUiSettings(
  ui: NonNullable<SettingsSetMessage['ui']>,
  update: ConfigUpdate,
  cfg: vscode.WorkspaceConfiguration,
  invalidateClient: () => void,
): Promise<void> {
  if (ui.showReasoning !== undefined) {
    await update('ui.showReasoning', ui.showReasoning);
  }
  if (ui.features?.codeReviewButton !== undefined) {
    await update(
      'ui.features.codeReviewButton',
      ui.features.codeReviewButton === true,
    );
  }
  if (ui.developerEnabled !== undefined) {
    await update('developer.enabled', ui.developerEnabled);
  }
  if (ui.intensityOverrides !== undefined) {
    await update('developer.intensityOverrides', ui.intensityOverrides);
  }
  if (ui.debugLogging !== undefined) {
    await update('debug', ui.debugLogging);
  }
  if (ui.modelIoLogging !== undefined) {
    await update('developer.modelIo', ui.modelIoLogging);
  }
  if (ui.reasoningPreviewMaxChars !== undefined) {
    await update('ui.reasoningPreviewMaxChars', ui.reasoningPreviewMaxChars);
  }
  if (ui.depth !== undefined) {
    await update('ui.depth', ui.depth);
  }
  if (ui.effort !== undefined) {
    await update('ui.effort', ui.effort);
  }
  if (ui.modeDefaults) {
    for (const mode of ['ask', 'plan', 'agent'] as const) {
      const defaults = ui.modeDefaults[mode];
      if (!defaults) continue;
      if (defaults.thoroughness !== undefined) {
        await update(`ui.modeDefaults.${mode}.thoroughness`, defaults.thoroughness);
      }
      if (defaults.depth !== undefined) {
        await update(`ui.modeDefaults.${mode}.depth`, defaults.depth);
      }
      if (defaults.approvalMode !== undefined) {
        await update(`ui.modeDefaults.${mode}.approvalMode`, defaults.approvalMode);
      }
      if (defaults.model !== undefined) {
        await update(`ui.modeDefaults.${mode}.model`, defaults.model.trim());
      }
    }
  }
  if (ui.runBudget) {
    if (ui.runBudget.unlimited !== undefined) {
      await update('runBudget.unlimited', ui.runBudget.unlimited);
    }
    const writeBudgetNumber = async (
      key: Exclude<keyof RunBudgetSettingsSnapshot, 'unlimited'>,
      setting: string,
      minimum: number,
    ) => {
      const value = ui?.runBudget?.[key];
      if (value === undefined) return;
      await update(
        setting,
        Math.max(minimum, Math.floor(Number(value) || 0)),
      );
    };
    await writeBudgetNumber('maxModelCalls', 'runBudget.maxModelCalls', 1);
    await writeBudgetNumber('maxToolCalls', 'runBudget.maxToolCalls', 1);
    await writeBudgetNumber(
      'maxLoopIterations',
      'runBudget.maxLoopIterations',
      1,
    );
    await writeBudgetNumber(
      'maxWallTimeMinutes',
      'runBudget.maxWallTimeMinutes',
      1,
    );
  }
  if (ui.tokenBudget) {
    if (ui.tokenBudget.enabled !== undefined) {
      await update('tokenBudget.enabled', ui.tokenBudget.enabled);
    }
    // Skip dozens of policy keys when custom budgets are off — Save was
    // blocking on ~68 sequential VS Code configuration writes.
    const tokenBudgetEnabled =
      ui.tokenBudget.enabled ??
      cfg.get<boolean>('tokenBudget.enabled') === true;
    if (ui.tokenBudget.policy && tokenBudgetEnabled) {
      for (const field of TOKEN_BUDGET_FIELDS) {
        const value = ui.tokenBudget.policy[field.key];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          continue;
        }
        const bounded = Math.max(
          field.min,
          Math.min(field.max ?? Number.POSITIVE_INFINITY, value),
        );
        await update(
          `tokenBudget.${field.key}`,
          field.kind === 'int' ? Math.floor(bounded) : bounded,
        );
      }
    }
  }
  if (ui.loopPolicy) {
    if (ui.loopPolicy.enabled !== undefined) {
      await update('loopPolicy.enabled', ui.loopPolicy.enabled);
    }
    const loopPolicyEnabled =
      ui.loopPolicy.enabled ??
      cfg.get<boolean>('loopPolicy.enabled') === true;
    if (ui.loopPolicy.thresholds && loopPolicyEnabled) {
      for (const field of LOOP_POLICY_FIELDS) {
        const value = ui.loopPolicy.thresholds[field.key];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          continue;
        }
        const bounded = Math.max(
          field.min,
          Math.min(field.max ?? Number.POSITIVE_INFINITY, value),
        );
        await update(
          `loopPolicy.${field.key}`,
          field.kind === 'int' ? Math.floor(bounded) : bounded,
        );
      }
    }
  }
  if (ui.v8LoopPolicy) {
    if (ui.v8LoopPolicy.enabled !== undefined) {
      await update('v8LoopPolicy.enabled', ui.v8LoopPolicy.enabled);
    }
    const v8Enabled =
      ui.v8LoopPolicy.enabled ??
      cfg.get<boolean>('v8LoopPolicy.enabled') === true;
    if (ui.v8LoopPolicy.thresholds && v8Enabled) {
      for (const field of V8_LOOP_POLICY_FIELDS) {
        const value = ui.v8LoopPolicy.thresholds[field.key];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          continue;
        }
        const bounded = Math.max(
          field.min,
          Math.min(field.max ?? Number.POSITIVE_INFINITY, value),
        );
        await update(
          `v8LoopPolicy.${field.key}`,
          field.kind === 'int' ? Math.floor(bounded) : bounded,
        );
      }
    }
  }
  if (ui.contextToggles) {
    for (const [key, value] of Object.entries(ui.contextToggles)) {
      if (value === undefined) continue;
      await update(`ui.contextToggles.${key}`, value);
    }
    if (ui.contextToggles.memory !== undefined) {
      invalidateClient();
    }
  }
}
