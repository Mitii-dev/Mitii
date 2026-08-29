import type { TokenBudgetPreview } from './protocol.js';

/**
 * Built-in Window Budget defaults. Keep aligned with
 * `packages/v8/src/modules/window-budget/defaults.ts`.
 * Used by the settings UI so a draft context window can recompute
 * every derived budget before Save.
 */
export const DEFAULT_WINDOW_BUDGET_NUMBERS: Record<string, number> = {
  outputRatio: 0.2,
  outputMinTokens: 10_240,
  outputMaxTokens: 32_768,
  outputWindowCapRatio: 0.35,
  toolSchemaFallbackTokens: 8_000,
  toolSchemaFallbackWindowRatio: 0.2,
  minimumUsableInputTokens: 2_048,
  loopSafetyRatio: 0.94,
  repositoryShare: 0.28,
  conversationShare: 0.4,
  planShare: 0.06,
  skillsShare: 0.04,
  planTokensCap: 16_000,
  skillsTokensCap: 8_000,
  repositoryTokensCap: 64_000,
  compactionWarnRatio: 0.7,
  compactionAutoRatio: 0.8,
  compactionHardRatio: 0.92,
  keepRecentToolResultsRatio: 0.00008,
  keepRecentToolResultsMin: 3,
  keepRecentToolResultsMax: 16,
  compactedToolResultCharsRatio: 0.006,
  compactedToolResultCharsMin: 400,
  compactedToolResultCharsMax: 4_000,
  compactedToolArgumentCharsRatio: 0.003,
  compactedToolArgumentCharsMin: 256,
  compactedToolArgumentCharsMax: 2_000,
  toolResultContentCharsRatio: 0.015,
  toolResultContentCharsMin: 2_000,
  toolResultContentCharsMax: 24_000,
  droppedTurnSummaryCharsRatio: 0.01,
  droppedTurnSummaryCharsMin: 1_200,
  droppedTurnSummaryCharsMax: 8_000,
  establishedFactCharsRatio: 0.002,
  establishedFactCharsMin: 220,
  establishedFactCharsMax: 900,
  establishedFactCountRatio: 0.00015,
  establishedFactCountMin: 12,
  establishedFactCountMax: 48,
  establishedFactReinjectCharsRatio: 0.012,
  establishedFactReinjectCharsMin: 1_600,
  establishedFactReinjectCharsMax: 8_000,
  memoryReinjectCharsRatio: 0.006,
  memoryReinjectCharsMin: 800,
  memoryReinjectCharsMax: 4_000,
  filesPerOutputTokens: 800,
  minUniqueFilesPerCall: 2,
  maxUniqueFilesPerCallCap: 48,
  patchPayloadOutputRatio: 0.6,
  charsPerOutputToken: 3,
  requireBatchedBelowOutputTokens: 4_096,
  visiblePlanMinUsableTokens: 8_192,
  changeImpactMinUsableTokens: 8_192,
  visiblePlanMinUsableRatio: 0.35,
  changeImpactMinUsableRatio: 0.35,
  maxPatchesPerCallCap: 96,
  diagnosticStepsBase: 2,
  diagnosticStepsPerUsable: 20_000,
  diagnosticStepsMax: 8,
  maxTasksBase: 8,
  maxTasksPerUsable: 25_000,
  maxTasksCap: 12,
  maxModelCallsPerUsable: 2_500,
  maxModelCallsMin: 48,
  maxModelCallsMax: 96,
  maxSkillsBase: 2,
  maxSkillsPerUsable: 12_000,
  maxSkillsCap: 4,
  verificationChecksBase: 2,
  verificationChecksPerUsable: 40_000,
  verificationChecksMax: 16,
};

/**
 * Medium working-set overlay. Keep aligned with
 * `packages/v8/src/modules/window-budget/effort.ts`.
 * Live preview cannot import V8; hosts still derive from `deriveWindowPolicy`.
 */
const MEDIUM_WINDOW_BUDGET_EFFORT = {
  maxUniqueFilesPerCall: 8,
  maxModelCalls: 64,
  compactionAutoMaxTokens: 32_000,
  compactionHardMaxTokens: 40_000,
} as const;

export const SIMPLE_TOKEN_BUDGET_KEYS = [
  'outputRatio',
  'repositoryShare',
  'conversationShare',
  'planShare',
  'skillsShare',
] as const;

export type WindowAllocationSliceId =
  | 'output'
  | 'tools'
  | 'repository'
  | 'conversation'
  | 'plan'
  | 'skills'
  | 'system';

export interface WindowAllocationSlice {
  id: WindowAllocationSliceId;
  label: string;
  tokens: number;
  windowShare: number;
}

export interface LiveTokenBudgetInput {
  contextWindowTokens: number;
  maximumOutputTokens?: number;
  policy?: Record<string, number>;
  runBudget?: {
    unlimited: boolean;
    maxModelCalls: number;
    maxToolCalls: number;
  };
}

function clampInt(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function policyNumber(
  policy: Record<string, number>,
  key: string,
): number {
  const value = policy[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : DEFAULT_WINDOW_BUDGET_NUMBERS[key];
}

export function mergeLiveWindowBudgetPolicy(
  overrides?: Record<string, number>,
): Record<string, number> {
  const merged = { ...DEFAULT_WINDOW_BUDGET_NUMBERS };
  if (!overrides) return merged;
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      merged[key] = value;
    }
  }
  return merged;
}

export function safeSliderValue(
  value: number,
  min: number,
  max: number,
): number {
  if (!Number.isFinite(value)) return min;
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

export function resolvePreviewContextWindow(input: {
  draft?: number;
  stored: number;
  effective?: number;
  fallback: number;
}): number {
  const pick = (value: number | undefined): number | undefined => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    const rounded = Math.floor(value);
    return rounded > 0 ? rounded : undefined;
  };
  return (
    pick(input.draft) ??
    pick(input.stored) ??
    pick(input.effective) ??
    pick(input.fallback) ??
    32_768
  );
}

export function isPolicyValueCustom(
  policy: Record<string, number> | undefined,
  key: string,
): boolean {
  if (!policy || !(key in policy)) return false;
  const current = policy[key];
  const baseline = DEFAULT_WINDOW_BUDGET_NUMBERS[key];
  if (typeof current !== 'number' || !Number.isFinite(current)) return false;
  return current !== baseline;
}

export function isFilesPerMutationPinned(
  policy: Record<string, number> | undefined,
): boolean {
  if (!policy) return false;
  const merged = mergeLiveWindowBudgetPolicy(policy);
  return (
    merged.minUniqueFilesPerCall === merged.maxUniqueFilesPerCallCap &&
    (merged.minUniqueFilesPerCall !==
      DEFAULT_WINDOW_BUDGET_NUMBERS.minUniqueFilesPerCall ||
      merged.maxUniqueFilesPerCallCap !==
        DEFAULT_WINDOW_BUDGET_NUMBERS.maxUniqueFilesPerCallCap)
  );
}

export function isVerificationChecksPinned(
  policy: Record<string, number> | undefined,
): boolean {
  if (!policy) return false;
  const merged = mergeLiveWindowBudgetPolicy(policy);
  return (
    merged.verificationChecksBase === merged.verificationChecksMax &&
    (merged.verificationChecksBase !==
      DEFAULT_WINDOW_BUDGET_NUMBERS.verificationChecksBase ||
      merged.verificationChecksMax !==
        DEFAULT_WINDOW_BUDGET_NUMBERS.verificationChecksMax)
  );
}

export function policyForFilesPerMutation(
  count: number,
): Record<string, number> {
  const pinned = clampInt(count, 1, 48);
  return {
    minUniqueFilesPerCall: pinned,
    maxUniqueFilesPerCallCap: pinned,
  };
}

export function policyForVerificationChecks(
  count: number,
): Record<string, number> {
  const pinned = clampInt(count, 1, 16);
  return {
    verificationChecksBase: pinned,
    verificationChecksMax: pinned,
  };
}

/**
 * Display-only Window Budget derivation for live settings.
 * Mirrors V8 `deriveWindowPolicy` so the Provider and Developer
 * tabs update as soon as the context window or a simple slider changes.
 */
export function deriveLiveTokenBudgetPreview(
  input: LiveTokenBudgetInput,
): TokenBudgetPreview {
  const policy = mergeLiveWindowBudgetPolicy(input.policy);
  const windowTokens = Math.max(
    1,
    Math.floor(input.contextWindowTokens) || 1,
  );

  const windowOutputCap = Math.min(
    policyNumber(policy, 'outputMaxTokens'),
    Math.max(
      1,
      Math.floor(windowTokens * policyNumber(policy, 'outputWindowCapRatio')),
    ),
    Math.max(1, windowTokens - 1),
  );
  const outputMin = Math.min(
    policyNumber(policy, 'outputMinTokens'),
    windowOutputCap,
  );
  const derivedOutput = clampInt(
    Math.floor(windowTokens * policyNumber(policy, 'outputRatio')),
    outputMin,
    windowOutputCap,
  );

  const rawHostOutput = input.maximumOutputTokens ?? 0;
  const hostOutput = rawHostOutput === 5_000 ? 0 : rawHostOutput;
  const maximumOutputTokens =
    hostOutput > 0
      ? clampInt(hostOutput, 1, Math.max(1, windowTokens - 1))
      : derivedOutput;

  const fallbackTools = Math.min(
    policyNumber(policy, 'toolSchemaFallbackTokens'),
    Math.floor(
      windowTokens * policyNumber(policy, 'toolSchemaFallbackWindowRatio'),
    ),
  );
  const remainingAfterOutput = Math.max(0, windowTokens - maximumOutputTokens);
  const toolSchemaTokens = Math.min(
    fallbackTools,
    Math.max(
      0,
      remainingAfterOutput - policyNumber(policy, 'minimumUsableInputTokens'),
    ),
  );
  let usableInputTokens = Math.max(0, remainingAfterOutput - toolSchemaTokens);
  if (usableInputTokens < policyNumber(policy, 'minimumUsableInputTokens')) {
    usableInputTokens = Math.min(
      policyNumber(policy, 'minimumUsableInputTokens'),
      remainingAfterOutput,
    );
  }

  const loopInputBudgetTokens = Math.max(
    1,
    Math.floor(usableInputTokens * policyNumber(policy, 'loopSafetyRatio')),
  );
  const repositoryTokens = Math.min(
    policyNumber(policy, 'repositoryTokensCap'),
    Math.floor(usableInputTokens * policyNumber(policy, 'repositoryShare')),
  );
  const conversationTokens = Math.floor(
    usableInputTokens * policyNumber(policy, 'conversationShare'),
  );
  const planTokens = clampInt(
    Math.floor(usableInputTokens * policyNumber(policy, 'planShare')),
    1,
    policyNumber(policy, 'planTokensCap'),
  );
  const skillsTokens = clampInt(
    Math.floor(usableInputTokens * policyNumber(policy, 'skillsShare')),
    1,
    policyNumber(policy, 'skillsTokensCap'),
  );
  const systemTokens = Math.max(
    0,
    usableInputTokens -
      (repositoryTokens + conversationTokens + planTokens + skillsTokens),
  );

  const maxUniqueFilesPerCall = clampInt(
    Math.floor(
      (windowTokens * policyNumber(policy, 'outputRatio')) /
        policyNumber(policy, 'filesPerOutputTokens'),
    ),
    policyNumber(policy, 'minUniqueFilesPerCall'),
    Math.min(
      policyNumber(policy, 'maxUniqueFilesPerCallCap'),
      MEDIUM_WINDOW_BUDGET_EFFORT.maxUniqueFilesPerCall,
    ),
  );
  const maxPatchesPerCall = clampInt(
    maxUniqueFilesPerCall * 2,
    maxUniqueFilesPerCall,
    policyNumber(policy, 'maxPatchesPerCallCap'),
  );
  const maxPatchPayloadCharacters = Math.max(
    1,
    Math.floor(
      maximumOutputTokens *
        policyNumber(policy, 'charsPerOutputToken') *
        policyNumber(policy, 'patchPayloadOutputRatio'),
    ),
  );
  const maxDiagnosticSteps = clampInt(
    policyNumber(policy, 'diagnosticStepsBase') +
      Math.floor(
        usableInputTokens / policyNumber(policy, 'diagnosticStepsPerUsable'),
      ),
    policyNumber(policy, 'diagnosticStepsBase'),
    policyNumber(policy, 'diagnosticStepsMax'),
  );
  const maxTasks = clampInt(
    policyNumber(policy, 'maxTasksBase') +
      Math.floor(usableInputTokens / policyNumber(policy, 'maxTasksPerUsable')),
    policyNumber(policy, 'maxTasksBase'),
    policyNumber(policy, 'maxTasksCap'),
  );
  const maxModelCalls = MEDIUM_WINDOW_BUDGET_EFFORT.maxModelCalls;
  const maxSkills = clampInt(
    policyNumber(policy, 'maxSkillsBase') +
      Math.floor(usableInputTokens / policyNumber(policy, 'maxSkillsPerUsable')),
    policyNumber(policy, 'maxSkillsBase'),
    policyNumber(policy, 'maxSkillsCap'),
  );
  const maxVerificationChecks = clampInt(
    policyNumber(policy, 'verificationChecksBase') +
      Math.floor(
        usableInputTokens / policyNumber(policy, 'verificationChecksPerUsable'),
      ),
    policyNumber(policy, 'verificationChecksBase'),
    policyNumber(policy, 'verificationChecksMax'),
  );
  const visiblePlanThreshold = Math.min(
    policyNumber(policy, 'visiblePlanMinUsableTokens'),
    Math.max(
      1,
      Math.floor(
        windowTokens * policyNumber(policy, 'visiblePlanMinUsableRatio'),
      ),
    ),
  );
  const changeImpactThreshold = Math.min(
    policyNumber(policy, 'changeImpactMinUsableTokens'),
    Math.max(
      1,
      Math.floor(
        windowTokens * policyNumber(policy, 'changeImpactMinUsableRatio'),
      ),
    ),
  );

  return {
    contextWindowTokens: windowTokens,
    maximumOutputTokens,
    toolSchemaTokens,
    usableInputTokens,
    loopInputBudgetTokens,
    repositoryTokens,
    conversationTokens,
    planTokens,
    skillsTokens,
    systemTokens,
    compactionWarnTokens: Math.floor(
      loopInputBudgetTokens * policyNumber(policy, 'compactionWarnRatio'),
    ),
    compactionAutoTokens: Math.min(
      Math.floor(
        loopInputBudgetTokens * policyNumber(policy, 'compactionAutoRatio'),
      ),
      MEDIUM_WINDOW_BUDGET_EFFORT.compactionAutoMaxTokens,
    ),
    compactionHardTokens: Math.min(
      Math.floor(
        loopInputBudgetTokens * policyNumber(policy, 'compactionHardRatio'),
      ),
      MEDIUM_WINDOW_BUDGET_EFFORT.compactionHardMaxTokens,
    ),
    keepRecentToolResults: clampInt(
      Math.floor(
        usableInputTokens * policyNumber(policy, 'keepRecentToolResultsRatio'),
      ),
      policyNumber(policy, 'keepRecentToolResultsMin'),
      policyNumber(policy, 'keepRecentToolResultsMax'),
    ),
    compactedToolResultChars: clampInt(
      Math.floor(
        usableInputTokens * policyNumber(policy, 'compactedToolResultCharsRatio'),
      ),
      policyNumber(policy, 'compactedToolResultCharsMin'),
      policyNumber(policy, 'compactedToolResultCharsMax'),
    ),
    compactedToolArgumentChars: clampInt(
      Math.floor(
        usableInputTokens *
          policyNumber(policy, 'compactedToolArgumentCharsRatio'),
      ),
      policyNumber(policy, 'compactedToolArgumentCharsMin'),
      policyNumber(policy, 'compactedToolArgumentCharsMax'),
    ),
    toolResultContentChars: clampInt(
      Math.floor(
        usableInputTokens * policyNumber(policy, 'toolResultContentCharsRatio'),
      ),
      policyNumber(policy, 'toolResultContentCharsMin'),
      policyNumber(policy, 'toolResultContentCharsMax'),
    ),
    droppedTurnSummaryChars: clampInt(
      Math.floor(
        usableInputTokens * policyNumber(policy, 'droppedTurnSummaryCharsRatio'),
      ),
      policyNumber(policy, 'droppedTurnSummaryCharsMin'),
      policyNumber(policy, 'droppedTurnSummaryCharsMax'),
    ),
    establishedFactChars: clampInt(
      Math.floor(
        usableInputTokens * policyNumber(policy, 'establishedFactCharsRatio'),
      ),
      policyNumber(policy, 'establishedFactCharsMin'),
      policyNumber(policy, 'establishedFactCharsMax'),
    ),
    maxEstablishedFacts: clampInt(
      Math.floor(
        usableInputTokens * policyNumber(policy, 'establishedFactCountRatio'),
      ),
      policyNumber(policy, 'establishedFactCountMin'),
      policyNumber(policy, 'establishedFactCountMax'),
    ),
    establishedFactReinjectChars: clampInt(
      Math.floor(
        usableInputTokens *
          policyNumber(policy, 'establishedFactReinjectCharsRatio'),
      ),
      policyNumber(policy, 'establishedFactReinjectCharsMin'),
      policyNumber(policy, 'establishedFactReinjectCharsMax'),
    ),
    memoryReinjectChars: clampInt(
      Math.floor(
        usableInputTokens * policyNumber(policy, 'memoryReinjectCharsRatio'),
      ),
      policyNumber(policy, 'memoryReinjectCharsMin'),
      policyNumber(policy, 'memoryReinjectCharsMax'),
    ),
    maxPatchesPerCall,
    maxModelCalls,
    maxToolCalls: maxModelCalls * 2,
    maxUniqueFilesPerCall,
    maxPatchPayloadCharacters,
    requireBatchedExecution:
      maximumOutputTokens <
      policyNumber(policy, 'requireBatchedBelowOutputTokens'),
    maxDiagnosticSteps,
    maxTasks,
    maxSkills,
    maxVerificationChecks,
    visiblePlanAffordable: usableInputTokens >= visiblePlanThreshold,
    changeImpactAffordable: usableInputTokens >= changeImpactThreshold,
    runBudgetUnlimited: input.runBudget?.unlimited === true,
    runBudgetMaxModelCalls:
      input.runBudget?.maxModelCalls ?? maxModelCalls,
    runBudgetMaxToolCalls: input.runBudget?.maxToolCalls ?? maxModelCalls * 2,
  };
}

const ALLOCATION_META: Array<{
  id: WindowAllocationSliceId;
  label: string;
  tokens: (preview: TokenBudgetPreview) => number;
}> = [
  {
    id: 'output',
    label: 'Output',
    tokens: (preview) => preview.maximumOutputTokens,
  },
  {
    id: 'tools',
    label: 'Tool schemas',
    tokens: (preview) => preview.toolSchemaTokens,
  },
  {
    id: 'repository',
    label: 'Repository',
    tokens: (preview) => preview.repositoryTokens,
  },
  {
    id: 'conversation',
    label: 'Conversation',
    tokens: (preview) => preview.conversationTokens,
  },
  { id: 'plan', label: 'Plan', tokens: (preview) => preview.planTokens },
  { id: 'skills', label: 'Skills', tokens: (preview) => preview.skillsTokens },
  {
    id: 'system',
    label: 'System / rules',
    tokens: (preview) => preview.systemTokens,
  },
];

export function windowAllocationSlices(
  preview: TokenBudgetPreview,
): WindowAllocationSlice[] {
  const windowTokens = Math.max(1, preview.contextWindowTokens);
  return ALLOCATION_META.map((entry) => {
    const tokens = Math.max(0, entry.tokens(preview));
    return {
      id: entry.id,
      label: entry.label,
      tokens,
      windowShare: tokens / windowTokens,
    };
  });
}
