import type { TokenBudgetPreview } from './protocol.js';
import {
  DEFAULT_WINDOW_BUDGET_NUMBERS,
  MEDIUM_WINDOW_BUDGET_EFFORT,
  WINDOW_BUDGET_BAND_OVERLAYS,
} from './liveWindowBudgetDefaults.js';
export { DEFAULT_WINDOW_BUDGET_NUMBERS } from './liveWindowBudgetDefaults.js';
export {
  windowAllocationSlices,
  type WindowAllocationSlice,
  type WindowAllocationSliceId,
} from './liveWindowBudgetAllocation.js';

/** Historical VS Code default; treated as unset so output scales with the window. */
export const LEGACY_DEFAULT_MAXIMUM_OUTPUT_TOKENS = 5_000;

export function normalizeMaximumOutputTokens(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return 0;
  const floored = Math.floor(value);
  return floored === LEGACY_DEFAULT_MAXIMUM_OUTPUT_TOKENS ? 0 : floored;
}

export function isAutoMaximumOutputTokens(raw: unknown): boolean {
  return normalizeMaximumOutputTokens(raw) === 0;
}

/** Keep aligned with scaleEffortCallBudget in window-budget/effort.ts. */
function scaleEffortCallBudget(base: number, contextWindowTokens: number): number {
  const window = Math.floor(contextWindowTokens);
  const calls = Math.max(1, Math.floor(base));
  if (!Number.isFinite(window) || window < 50_000) return calls;
  if (window < 100_000) return Math.max(calls, Math.round(calls * 1.5));
  return calls * 2;
}

export function resolveLiveWindowBudgetBand(
  contextWindowTokens: number,
): 'compact' | 'standard' | 'wide' {
  const window = Math.floor(contextWindowTokens);
  if (!Number.isFinite(window) || window <= 0) return 'compact';
  if (window < 50_000) return 'compact';
  if (window < 100_000) return 'standard';
  return 'wide';
}

function resolveMediumCompactionCeilings(contextWindowTokens: number): {
  autoMaxTokens: number;
  hardMaxTokens: number;
} {
  const windowTokens = Math.max(1, Math.floor(contextWindowTokens));
  const autoMaxTokens = Math.max(
    MEDIUM_WINDOW_BUDGET_EFFORT.compactionAutoMinTokens,
    Math.floor(
      windowTokens * MEDIUM_WINDOW_BUDGET_EFFORT.compactionAutoWindowRatio,
    ),
  );
  const hardMaxTokens = Math.max(
    MEDIUM_WINDOW_BUDGET_EFFORT.compactionHardMinTokens,
    Math.floor(
      windowTokens * MEDIUM_WINDOW_BUDGET_EFFORT.compactionHardWindowRatio,
    ),
    autoMaxTokens,
  );
  return { autoMaxTokens, hardMaxTokens };
}

export const SIMPLE_TOKEN_BUDGET_KEYS = [
  'outputRatio',
  'repositoryShare',
  'conversationShare',
  'planShare',
  'skillsShare',
] as const;

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
  contextWindowTokens?: number,
): Record<string, number> {
  const merged = { ...DEFAULT_WINDOW_BUDGET_NUMBERS };
  if (
    typeof contextWindowTokens === 'number' &&
    Number.isFinite(contextWindowTokens)
  ) {
    const band = resolveLiveWindowBudgetBand(contextWindowTokens);
    Object.assign(merged, WINDOW_BUDGET_BAND_OVERLAYS[band]);
  }
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
  const windowTokens = Math.max(
    1,
    Math.floor(input.contextWindowTokens) || 1,
  );
  const policy = mergeLiveWindowBudgetPolicy(input.policy, windowTokens);

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

  const rawHostOutput = normalizeMaximumOutputTokens(
    input.maximumOutputTokens ?? 0,
  );
  const maximumOutputTokens =
    rawHostOutput > 0
      ? clampInt(rawHostOutput, 1, Math.max(1, windowTokens - 1))
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
  // Residual usable capacity when module shares sum to less than 100%.
  // Shown in the UI as Free (unallocated) — shares are not forced to 100%.
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
  const maxModelCalls = scaleEffortCallBudget(
    MEDIUM_WINDOW_BUDGET_EFFORT.maxModelCalls,
    windowTokens,
  );
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

  const compactionCeilings = resolveMediumCompactionCeilings(windowTokens);
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
      compactionCeilings.autoMaxTokens,
    ),
    compactionHardTokens: Math.min(
      Math.floor(
        loopInputBudgetTokens * policyNumber(policy, 'compactionHardRatio'),
      ),
      compactionCeilings.hardMaxTokens,
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
    carryMaxMessages: clampInt(
      Math.floor(
        usableInputTokens * policyNumber(policy, 'carryMaxMessagesRatio'),
      ),
      policyNumber(policy, 'carryMaxMessagesMin'),
      policyNumber(policy, 'carryMaxMessagesMax'),
    ),
    carryMaxCharsPerMessage: clampInt(
      Math.floor(
        usableInputTokens * policyNumber(policy, 'carryMaxCharsPerMessageRatio'),
      ),
      policyNumber(policy, 'carryMaxCharsPerMessageMin'),
      policyNumber(policy, 'carryMaxCharsPerMessageMax'),
    ),
    injectionProjectRuleChars: clampInt(
      Math.floor(
        usableInputTokens *
          policyNumber(policy, 'injectionProjectRuleCharsRatio'),
      ),
      policyNumber(policy, 'injectionProjectRuleCharsMin'),
      policyNumber(policy, 'injectionProjectRuleCharsMax'),
    ),
    injectionProjectRulesTotalChars: clampInt(
      Math.floor(
        usableInputTokens *
          policyNumber(policy, 'injectionProjectRulesTotalCharsRatio'),
      ),
      policyNumber(policy, 'injectionProjectRulesTotalCharsMin'),
      policyNumber(policy, 'injectionProjectRulesTotalCharsMax'),
    ),
    injectionRepoMapChars: clampInt(
      Math.floor(
        usableInputTokens * policyNumber(policy, 'injectionRepoMapCharsRatio'),
      ),
      policyNumber(policy, 'injectionRepoMapCharsMin'),
      policyNumber(policy, 'injectionRepoMapCharsMax'),
    ),
    injectionRepoMapFilesMax: policyNumber(policy, 'injectionRepoMapFilesMax'),
    injectionSketchChars: clampInt(
      Math.floor(
        usableInputTokens * policyNumber(policy, 'injectionSketchCharsRatio'),
      ),
      policyNumber(policy, 'injectionSketchCharsMin'),
      policyNumber(policy, 'injectionSketchCharsMax'),
    ),
    injectionSketchItemsMax: policyNumber(policy, 'injectionSketchItemsMax'),
    injectionSelectionChars: clampInt(
      Math.floor(
        usableInputTokens *
          policyNumber(policy, 'injectionSelectionCharsRatio'),
      ),
      policyNumber(policy, 'injectionSelectionCharsMin'),
      policyNumber(policy, 'injectionSelectionCharsMax'),
    ),
    injectionReviewDiffFileChars: clampInt(
      Math.floor(
        usableInputTokens *
          policyNumber(policy, 'injectionReviewDiffFileCharsRatio'),
      ),
      policyNumber(policy, 'injectionReviewDiffFileCharsMin'),
      policyNumber(policy, 'injectionReviewDiffFileCharsMax'),
    ),
    injectionReviewDiffTotalChars: clampInt(
      Math.floor(
        usableInputTokens *
          policyNumber(policy, 'injectionReviewDiffTotalCharsRatio'),
      ),
      policyNumber(policy, 'injectionReviewDiffTotalCharsMin'),
      policyNumber(policy, 'injectionReviewDiffTotalCharsMax'),
    ),
  };
}
