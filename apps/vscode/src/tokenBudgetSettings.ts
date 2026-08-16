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
import type * as vscode from 'vscode';

import type {
  TokenBudgetFieldDescriptor,
  TokenBudgetPreview,
  TokenBudgetSettingsSnapshot,
} from './protocol.js';

export const TOKEN_BUDGET_FIELDS: readonly TokenBudgetFieldDescriptor[] = [
  {
    key: 'outputRatio',
    group: 'Output reserve',
    label: 'Output ratio',
    description: 'Fraction of the context window reserved for model output when max output is 0.',
    kind: 'ratio',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: 'outputMinTokens',
    group: 'Output reserve',
    label: 'Output minimum',
    description: 'Floor for the derived output reserve.',
    kind: 'int',
    min: 1,
    step: 256,
  },
  {
    key: 'outputMaxTokens',
    group: 'Output reserve',
    label: 'Output maximum',
    description: 'Ceiling for the derived output reserve.',
    kind: 'int',
    min: 1,
    step: 256,
  },
  {
    key: 'outputWindowCapRatio',
    group: 'Output reserve',
    label: 'Output window cap',
    description: 'Output cannot exceed this fraction of the advertised window.',
    kind: 'ratio',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: 'toolSchemaFallbackTokens',
    group: 'Tool schemas',
    label: 'Tool-schema fallback tokens',
    description: 'Used when tool JSON has not been measured yet.',
    kind: 'int',
    min: 0,
    step: 256,
  },
  {
    key: 'toolSchemaFallbackWindowRatio',
    group: 'Tool schemas',
    label: 'Tool-schema fallback window ratio',
    description: 'Fallback tool cost cannot exceed this fraction of the window.',
    kind: 'ratio',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: 'minimumUsableInputTokens',
    group: 'Tool schemas',
    label: 'Minimum usable input',
    description: 'Keep at least this many tokens for prompt/history after output and tools.',
    kind: 'int',
    min: 1,
    step: 256,
  },
  {
    key: 'loopSafetyRatio',
    group: 'Tool schemas',
    label: 'Loop safety ratio',
    description: 'Fraction of usable input allowed in the live model-loop budget.',
    kind: 'ratio',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: 'repositoryShare',
    group: 'Usable-input shares',
    label: 'Repository share',
    description: 'Share of usable input for repository context.',
    kind: 'ratio',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: 'conversationShare',
    group: 'Usable-input shares',
    label: 'Conversation share',
    description: 'Share of usable input for conversation and tool history.',
    kind: 'ratio',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: 'planShare',
    group: 'Usable-input shares',
    label: 'Plan share',
    description: 'Share of usable input for plan text.',
    kind: 'ratio',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: 'skillsShare',
    group: 'Usable-input shares',
    label: 'Skills share',
    description: 'Share of usable input for selected skill bodies.',
    kind: 'ratio',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: 'planTokensCap',
    group: 'Usable-input shares',
    label: 'Plan tokens cap',
    description: 'Hard cap on plan tokens regardless of share.',
    kind: 'int',
    min: 1,
    step: 256,
  },
  {
    key: 'skillsTokensCap',
    group: 'Usable-input shares',
    label: 'Skills tokens cap',
    description: 'Hard cap on skill-body tokens regardless of share.',
    kind: 'int',
    min: 1,
    step: 128,
  },
  {
    key: 'repositoryTokensCap',
    group: 'Usable-input shares',
    label: 'Repository tokens cap',
    description: 'Hard cap on repository-context tokens regardless of share.',
    kind: 'int',
    min: 1,
    step: 1024,
  },
  {
    key: 'compactionWarnRatio',
    group: 'Compaction',
    label: 'Warn ratio',
    description: 'Loop pressure warning fires at this fraction of the loop budget.',
    kind: 'ratio',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: 'compactionAutoRatio',
    group: 'Compaction',
    label: 'Auto-compact ratio',
    description: 'Automatic history compaction starts at this fraction of the loop budget.',
    kind: 'ratio',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: 'compactionHardRatio',
    group: 'Compaction',
    label: 'Hard-compact ratio',
    description: 'Aggressive compaction and memory reinject at this fraction of the loop budget.',
    kind: 'ratio',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: 'keepRecentToolResultsBase',
    group: 'Compaction',
    label: 'Keep recent tool results (base)',
    description: 'Minimum number of recent tool results kept in full.',
    kind: 'int',
    min: 1,
    step: 1,
  },
  {
    key: 'keepRecentToolResultsPerUsable',
    group: 'Compaction',
    label: 'Keep recent tool results per usable',
    description: 'Add one kept tool result per this many usable-input tokens.',
    kind: 'number',
    min: 1,
    step: 256,
  },
  {
    key: 'keepRecentToolResultsMax',
    group: 'Compaction',
    label: 'Keep recent tool results (max)',
    description: 'Maximum number of recent tool results kept in full.',
    kind: 'int',
    min: 1,
    step: 1,
  },
  {
    key: 'compactedToolResultCharsBase',
    group: 'Compaction',
    label: 'Compacted tool result chars (base)',
    description: 'Minimum characters retained for compacted tool results.',
    kind: 'int',
    min: 1,
    step: 50,
  },
  {
    key: 'compactedToolResultCharsPerUsable',
    group: 'Compaction',
    label: 'Compacted tool result chars per usable',
    description: 'Add one retained character per this many usable-input tokens.',
    kind: 'number',
    min: 1,
    step: 1,
  },
  {
    key: 'compactedToolResultCharsMax',
    group: 'Compaction',
    label: 'Compacted tool result chars (max)',
    description: 'Maximum characters retained for compacted tool results.',
    kind: 'int',
    min: 1,
    step: 100,
  },
  {
    key: 'filesPerOutputTokens',
    group: 'Mutation batches',
    label: 'Files per output tokens',
    description: 'Unique files per apply_patch call scale as output / this value.',
    kind: 'number',
    min: 1,
    step: 50,
  },
  {
    key: 'minUniqueFilesPerCall',
    group: 'Mutation batches',
    label: 'Minimum unique files per call',
    description: 'Floor for files allowed in one mutation call.',
    kind: 'int',
    min: 1,
    step: 1,
  },
  {
    key: 'maxUniqueFilesPerCallCap',
    group: 'Mutation batches',
    label: 'Maximum unique files per call',
    description: 'Ceiling for files allowed in one mutation call.',
    kind: 'int',
    min: 1,
    step: 1,
  },
  {
    key: 'patchPayloadOutputRatio',
    group: 'Mutation batches',
    label: 'Patch payload output ratio',
    description: 'Fraction of output tokens treated as patch payload capacity.',
    kind: 'ratio',
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    key: 'charsPerOutputToken',
    group: 'Mutation batches',
    label: 'Characters per output token',
    description: 'Approximate characters produced per output token for payload sizing.',
    kind: 'number',
    min: 1,
    step: 0.5,
  },
  {
    key: 'requireBatchedBelowOutputTokens',
    group: 'Mutation batches',
    label: 'Require batching below output',
    description: 'Force batched mutation when derived output is below this many tokens.',
    kind: 'int',
    min: 0,
    step: 256,
  },
  {
    key: 'visiblePlanMinUsableTokens',
    group: 'Planning',
    label: 'Visible-plan minimum usable',
    description: 'Visible plans are skipped when usable input is below this.',
    kind: 'int',
    min: 0,
    step: 1000,
  },
  {
    key: 'changeImpactMinUsableTokens',
    group: 'Planning',
    label: 'Change-impact minimum usable',
    description: 'Change-impact analysis is skipped when usable input is below this.',
    kind: 'int',
    min: 0,
    step: 1000,
  },
  {
    key: 'diagnosticStepsBase',
    group: 'Planning',
    label: 'Diagnostic steps (base)',
    description: 'Minimum diagnostic change steps in a drafted plan.',
    kind: 'int',
    min: 1,
    step: 1,
  },
  {
    key: 'diagnosticStepsPerUsable',
    group: 'Planning',
    label: 'Diagnostic steps per usable',
    description: 'Add one diagnostic step per this many usable-input tokens.',
    kind: 'number',
    min: 1,
    step: 1000,
  },
  {
    key: 'diagnosticStepsMax',
    group: 'Planning',
    label: 'Diagnostic steps (max)',
    description: 'Ceiling for diagnostic change steps.',
    kind: 'int',
    min: 1,
    step: 1,
  },
  {
    key: 'maxModelCallsPerUsable',
    group: 'Run caps',
    label: 'Model calls per usable',
    description: 'Suggested model-call cap scales as usable input / this value.',
    kind: 'number',
    min: 1,
    step: 100,
    hiddenFromDebug: true,
  },
  {
    key: 'maxModelCallsMin',
    group: 'Run caps',
    label: 'Model calls (min)',
    description: 'Floor for the window-derived model-call cap. Host run budget cannot exceed this ceiling.',
    kind: 'int',
    min: 1,
    step: 1,
    hiddenFromDebug: true,
  },
  {
    key: 'maxModelCallsMax',
    group: 'Run caps',
    label: 'Model calls (max)',
    description: 'Ceiling for the window-derived model-call cap when Modes run budget is limited.',
    kind: 'int',
    min: 1,
    step: 1,
    hiddenFromDebug: true,
  },
  {
    key: 'maxSkillsBase',
    group: 'Skills',
    label: 'Skills (base)',
    description: 'Minimum number of skills that may be selected.',
    kind: 'int',
    min: 1,
    step: 1,
  },
  {
    key: 'maxSkillsPerUsable',
    group: 'Skills',
    label: 'Skills per usable',
    description: 'Add one selectable skill per this many usable-input tokens.',
    kind: 'number',
    min: 1,
    step: 1000,
  },
  {
    key: 'maxSkillsCap',
    group: 'Skills',
    label: 'Skills (max)',
    description: 'Ceiling for selected skills.',
    kind: 'int',
    min: 1,
    step: 1,
  },
  {
    key: 'verificationChecksBase',
    group: 'Verification',
    label: 'Verification checks (base)',
    description: 'Minimum verification checks after mutations.',
    kind: 'int',
    min: 1,
    step: 1,
  },
  {
    key: 'verificationChecksPerUsable',
    group: 'Verification',
    label: 'Verification checks per usable',
    description: 'Add one verification check per this many usable-input tokens.',
    kind: 'number',
    min: 1,
    step: 1000,
  },
  {
    key: 'verificationChecksMax',
    group: 'Verification',
    label: 'Verification checks (max)',
    description: 'Ceiling for verification checks.',
    kind: 'int',
    min: 1,
    step: 1,
  },
];

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
    repositoryTokens: policy.sections.repositoryTokens,
    conversationTokens: policy.sections.conversationTokens,
    planTokens: policy.sections.planTokens,
    skillsTokens: policy.sections.skillsTokens,
    systemTokens: policy.sections.systemTokens,
    maxModelCalls: policy.run.maxModelCalls,
    maxToolCalls: policy.run.maxToolCalls,
    maxUniqueFilesPerCall: policy.mutation.maxUniqueFilesPerCall,
    visiblePlanAffordable: policy.planning.visiblePlanAffordable,
    changeImpactAffordable: policy.planning.changeImpactAffordable,
    runBudgetUnlimited: runBudget?.unlimited === true,
    runBudgetMaxModelCalls:
      runBudget?.maxModelCalls ?? policy.run.maxModelCalls,
    runBudgetMaxToolCalls: runBudget?.maxToolCalls ?? policy.run.maxToolCalls,
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
