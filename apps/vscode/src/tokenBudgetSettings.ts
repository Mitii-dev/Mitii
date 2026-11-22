import {
  DEFAULT_WINDOW_BUDGET_POLICY,
  WINDOW_BUDGET_SCHEMA_VERSION,
  deriveWindowPolicy,
  mergeWindowBudgetPolicy,
  windowBudgetPolicyOverridesSchema,
} from '@mitii/sdk';
import type {
  WindowBudgetPolicy,
  WindowBudgetPolicyOverrides,
  WindowPolicy,
} from '@mitii/sdk';
import { projectNumberFields } from '@mitii/settings';
import type * as vscode from 'vscode';

import type {
  TokenBudgetFieldDescriptor,
  TokenBudgetPreview,
  TokenBudgetSettingsSnapshot,
} from './protocol.js';
import { TOKEN_BUDGET_PRESENTATION } from './tokenBudgetFieldPresentation.js';

/**
 * Developer Token Budget fields: keys, bounds, and descriptions come from the
 * `@mitii/settings` catalog; presentation from `TOKEN_BUDGET_PRESENTATION`.
 * `defaultValue` is the SDK ship baseline (`DEFAULT_WINDOW_BUDGET_POLICY`),
 * which may differ from the catalog default (see tokenBudgetFieldsFromCatalog
 * tests for the tracked drift).
 */
export const TOKEN_BUDGET_FIELDS: readonly TokenBudgetFieldDescriptor[] =
  projectNumberFields('tokenBudget', TOKEN_BUDGET_PRESENTATION, {
    tier: () => 'advanced',
  }).map((field) => {
    const baseline =
      DEFAULT_WINDOW_BUDGET_POLICY[field.key as keyof WindowBudgetPolicy];
    return typeof baseline === 'number'
      ? { ...field, defaultValue: baseline }
      : field;
  });

export function tokenBudgetResetKeys(): readonly string[] {
  return [
    'tokenBudget.enabled',
    ...TOKEN_BUDGET_FIELDS.map((field) => `tokenBudget.${field.key}`),
  ];
}

export function readTokenBudgetEnabled(
  cfg: vscode.WorkspaceConfiguration,
): boolean {
  return cfg.get<boolean>('tokenBudget.enabled') === true;
}

export function readTokenBudgetPolicy(
  cfg: vscode.WorkspaceConfiguration,
): WindowBudgetPolicy {
  const overrides: WindowBudgetPolicyOverrides = {};
  for (const field of TOKEN_BUDGET_FIELDS) {
    const value = cfg.get<number>(`tokenBudget.${field.key}`);
    if (typeof value === 'number' && Number.isFinite(value)) {
      overrides[field.key] = value;
    }
  }
  return mergeWindowBudgetPolicy(
    windowBudgetPolicyOverridesSchema.parse(overrides),
  );
}

export function readTokenBudgetPolicyOverrides(
  cfg: vscode.WorkspaceConfiguration,
): WindowBudgetPolicyOverrides | undefined {
  if (!readTokenBudgetEnabled(cfg)) {
    return undefined;
  }
  return readTokenBudgetPolicy(cfg);
}

export function toTokenBudgetPreview(
  policy: WindowPolicy,
  runBudget?: {
    unlimited: boolean;
    maxModelCalls: number;
    maxToolCalls: number;
  },
): TokenBudgetPreview {
  return {
    contextWindowTokens: policy.contextWindowTokens,
    maximumOutputTokens: policy.maximumOutputTokens,
    toolSchemaTokens: policy.toolSchemaTokens,
    usableInputTokens: policy.usableInputTokens,
    loopInputBudgetTokens: policy.loopInputBudgetTokens,
    repositoryTokens: policy.sections.repositoryTokens,
    conversationTokens: policy.sections.conversationTokens,
    planTokens: policy.sections.planTokens,
    skillsTokens: policy.sections.skillsTokens,
    systemTokens: policy.sections.systemTokens,
    compactionWarnTokens: Math.floor(
      policy.loopInputBudgetTokens * policy.compaction.warnRatio,
    ),
    compactionAutoTokens: Math.min(
      Math.floor(policy.loopInputBudgetTokens * policy.compaction.autoRatio),
      policy.compaction.autoMaxTokens,
    ),
    compactionHardTokens: Math.min(
      Math.floor(policy.loopInputBudgetTokens * policy.compaction.hardRatio),
      policy.compaction.hardMaxTokens,
    ),
    keepRecentToolResults: policy.compaction.keepRecentToolResults,
    compactedToolResultChars: policy.compaction.compactedToolResultChars,
    compactedToolArgumentChars: policy.compaction.compactedToolArgumentChars,
    toolResultContentChars: policy.compaction.toolResultContentChars,
    droppedTurnSummaryChars: policy.compaction.droppedTurnSummaryChars,
    establishedFactChars: policy.compaction.establishedFactChars,
    maxEstablishedFacts: policy.compaction.maxEstablishedFacts,
    establishedFactReinjectChars: policy.compaction.establishedFactReinjectChars,
    memoryReinjectChars: policy.compaction.memoryReinjectChars,
    maxPatchesPerCall: policy.mutation.maxPatchesPerCall,
    maxModelCalls: policy.run.maxModelCalls,
    maxToolCalls: policy.run.maxToolCalls,
    maxUniqueFilesPerCall: policy.mutation.maxUniqueFilesPerCall,
    maxPatchPayloadCharacters: policy.mutation.maxPatchPayloadCharacters,
    requireBatchedExecution: policy.mutation.requireBatchedExecution,
    maxDiagnosticSteps: policy.planning.maxDiagnosticSteps,
    maxTasks: policy.taskList.maxTasks,
    maxSkills: policy.skills.maxSkills,
    maxVerificationChecks: policy.maxVerificationChecks,
    visiblePlanAffordable: policy.planning.visiblePlanAffordable,
    changeImpactAffordable: policy.planning.changeImpactAffordable,
    runBudgetUnlimited: runBudget?.unlimited === true,
    runBudgetMaxModelCalls:
      runBudget?.maxModelCalls ?? policy.run.maxModelCalls,
    runBudgetMaxToolCalls: runBudget?.maxToolCalls ?? policy.run.maxToolCalls,
    carryMaxMessages: policy.carry.maxMessages,
    carryMaxCharsPerMessage: policy.carry.maxCharsPerMessage,
    injectionProjectRuleChars: policy.injection.projectRuleChars,
    injectionProjectRulesTotalChars: policy.injection.projectRulesTotalChars,
    injectionRepoMapChars: policy.injection.repoMapChars,
    injectionRepoMapFilesMax: policy.injection.repoMapFilesMax,
    injectionSketchChars: policy.injection.sketchChars,
    injectionSketchItemsMax: policy.injection.sketchItemsMax,
    injectionSelectionChars: policy.injection.selectionChars,
    injectionReviewDiffFileChars: policy.injection.reviewDiffFileChars,
    injectionReviewDiffTotalChars: policy.injection.reviewDiffTotalChars,
    fragmentAbsoluteMaxTokens: policy.fragments.absoluteMaxTokens,
    fragmentReviewThresholdTokens: policy.fragments.reviewThresholdTokens,
    fragmentAdditionalContextValueTokens:
      policy.fragments.additionalContextValueTokens,
    fragmentSkillCatalogL1MaxTokens: policy.fragments.skillCatalogL1MaxTokens,
    fragmentSkillCatalogL1MaxEntries: policy.fragments.skillCatalogL1MaxEntries,
  };
}

export function readTokenBudgetSettings(
  cfg: vscode.WorkspaceConfiguration,
  contextWindowTokens: number,
  maximumOutputTokens?: number,
): TokenBudgetSettingsSnapshot {
  const enabled = readTokenBudgetEnabled(cfg);
  const policy = readTokenBudgetPolicy(cfg);
  const derived = deriveWindowPolicy({
    schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
    contextWindowTokens: Math.max(1, Math.floor(contextWindowTokens) || 1),
    maximumOutputTokens:
      typeof maximumOutputTokens === 'number' &&
      Number.isFinite(maximumOutputTokens) &&
      maximumOutputTokens > 0
        ? Math.floor(maximumOutputTokens)
        : 0,
    policy: enabled ? policy : undefined,
  });
  const runBudget = {
    unlimited: cfg.get<boolean>('runBudget.unlimited') === true,
    maxModelCalls: cfg.get<number>('runBudget.maxModelCalls') ?? 64,
    maxToolCalls: cfg.get<number>('runBudget.maxToolCalls') ?? 128,
  };
  return {
    enabled,
    policy,
    fields: [...TOKEN_BUDGET_FIELDS],
    preview: toTokenBudgetPreview(derived, runBudget),
  };
}

export function defaultTokenBudgetSettings(
  contextWindowTokens = 32_768,
): TokenBudgetSettingsSnapshot {
  const derived = deriveWindowPolicy({
    schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
    contextWindowTokens,
  });
  return {
    enabled: false,
    policy: DEFAULT_WINDOW_BUDGET_POLICY,
    fields: [...TOKEN_BUDGET_FIELDS],
    preview: toTokenBudgetPreview(derived),
  };
}
