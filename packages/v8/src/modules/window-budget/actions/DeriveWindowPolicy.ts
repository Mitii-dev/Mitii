import {
  LEGACY_DEFAULT_MAXIMUM_OUTPUT_TOKENS,
  WINDOW_BUDGET_SCHEMA_VERSION,
} from "../constants";
import {
  WINDOW_BUDGET_EFFORT_OVERLAY,
  resolveWindowBudgetEffort,
} from "../effort";
import {
  WindowBudgetError,
  windowBudgetInputSchema,
  windowPolicySchema,
} from "../contracts";
import type {
  WindowBudgetInput,
  WindowBudgetReasonCode,
  WindowPolicy,
} from "../contracts";
import { resolveWindowBudgetPolicy } from "../policy";

/**
 * Derive a complete window allocation from advertised capabilities.
 * Tool schemas are a fixed cost; remaining usable input is split by policy shares.
 *
 * Policy merge: defaults → window band → optional host/lab overrides.
 */
export function deriveWindowPolicy(input: WindowBudgetInput): WindowPolicy {
  let parsed: WindowBudgetInput;
  try {
    parsed = windowBudgetInputSchema.parse(input);
  } catch (error) {
    throw new WindowBudgetError(
      "invalid_input",
      "Window Budget input failed schema validation.",
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }

  const windowTokens = parsed.contextWindowTokens;
  const policy = resolveWindowBudgetPolicy({
    contextWindowTokens: windowTokens,
    overrides: parsed.policy,
  }).policy;
  const reasonCodes: WindowBudgetReasonCode[] = [];
  const effort = resolveWindowBudgetEffort(parsed.effort);
  const overlay = WINDOW_BUDGET_EFFORT_OVERLAY[effort];
  reasonCodes.push(`effort_${effort}`);

  const windowOutputCap = Math.min(
    policy.outputMaxTokens,
    Math.max(1, Math.floor(windowTokens * policy.outputWindowCapRatio)),
    Math.max(1, windowTokens - 1),
  );
  const outputMin = Math.min(policy.outputMinTokens, windowOutputCap);
  const derivedOutput = clampInt(
    Math.floor(windowTokens * policy.outputRatio),
    outputMin,
    windowOutputCap,
  );

  const rawHostOutput = parsed.maximumOutputTokens ?? 0;
  const legacyHostDefault = rawHostOutput === LEGACY_DEFAULT_MAXIMUM_OUTPUT_TOKENS;
  const hostOutput = legacyHostDefault ? 0 : rawHostOutput;
  const maximumOutputTokens =
    hostOutput > 0
      ? clampInt(hostOutput, 1, Math.max(1, windowTokens - 1))
      : derivedOutput;
  if (legacyHostDefault) {
    reasonCodes.push("output_legacy_default_ignored");
  }
  reasonCodes.push(
    hostOutput > 0 ? "output_host_override" : "output_derived_from_window",
  );

  const measuredTools = parsed.toolSchemaTokens ?? 0;
  const fallbackTools = Math.min(
    policy.toolSchemaFallbackTokens,
    Math.floor(windowTokens * policy.toolSchemaFallbackWindowRatio),
  );
  const rawTools = measuredTools > 0 ? measuredTools : fallbackTools;
  reasonCodes.push(
    measuredTools > 0 ? "tool_schema_measured" : "tool_schema_fallback",
  );

  const remainingAfterOutput = Math.max(0, windowTokens - maximumOutputTokens);
  const toolSchemaTokens = Math.min(
    rawTools,
    Math.max(0, remainingAfterOutput - policy.minimumUsableInputTokens),
  );
  let usableInputTokens = Math.max(
    0,
    remainingAfterOutput - toolSchemaTokens,
  );
  if (usableInputTokens < policy.minimumUsableInputTokens) {
    usableInputTokens = Math.min(
      policy.minimumUsableInputTokens,
      remainingAfterOutput,
    );
    reasonCodes.push("usable_input_clamped");
  }

  const loopInputBudgetTokens = Math.max(
    1,
    Math.floor(usableInputTokens * policy.loopSafetyRatio),
  );

  const repositoryTokensShare = Math.floor(
    usableInputTokens * policy.repositoryShare,
  );
  const repositoryTokens = Math.min(
    policy.repositoryTokensCap,
    repositoryTokensShare,
  );
  if (repositoryTokensShare > policy.repositoryTokensCap) {
    reasonCodes.push("repository_tokens_capped");
  }
  const conversationTokens = Math.floor(
    usableInputTokens * policy.conversationShare,
  );
  const planTokensShare = Math.floor(usableInputTokens * policy.planShare);
  const planTokens = clampInt(planTokensShare, 1, policy.planTokensCap);
  if (planTokensShare > policy.planTokensCap) {
    reasonCodes.push("plan_tokens_capped");
  }
  const skillsTokensShare = Math.floor(usableInputTokens * policy.skillsShare);
  const skillsTokens = clampInt(skillsTokensShare, 1, policy.skillsTokensCap);
  if (skillsTokensShare > policy.skillsTokensCap) {
    reasonCodes.push("skills_tokens_capped");
  }
  const allocated =
    repositoryTokens + conversationTokens + planTokens + skillsTokens;
  const systemTokens = Math.max(0, usableInputTokens - allocated);

  const keepRecentToolResults = clampInt(
    Math.floor(usableInputTokens * policy.keepRecentToolResultsRatio),
    policy.keepRecentToolResultsMin,
    policy.keepRecentToolResultsMax,
  );
  const compactedToolResultChars = clampInt(
    Math.floor(usableInputTokens * policy.compactedToolResultCharsRatio),
    policy.compactedToolResultCharsMin,
    policy.compactedToolResultCharsMax,
  );
  const compactedToolArgumentChars = clampInt(
    Math.floor(usableInputTokens * policy.compactedToolArgumentCharsRatio),
    policy.compactedToolArgumentCharsMin,
    policy.compactedToolArgumentCharsMax,
  );
  const toolResultContentChars = clampInt(
    Math.floor(usableInputTokens * policy.toolResultContentCharsRatio),
    policy.toolResultContentCharsMin,
    policy.toolResultContentCharsMax,
  );
  const droppedTurnSummaryChars = clampInt(
    Math.floor(usableInputTokens * policy.droppedTurnSummaryCharsRatio),
    policy.droppedTurnSummaryCharsMin,
    policy.droppedTurnSummaryCharsMax,
  );
  const establishedFactChars = clampInt(
    Math.floor(usableInputTokens * policy.establishedFactCharsRatio),
    policy.establishedFactCharsMin,
    policy.establishedFactCharsMax,
  );
  const maxEstablishedFacts = clampInt(
    Math.floor(usableInputTokens * policy.establishedFactCountRatio),
    policy.establishedFactCountMin,
    policy.establishedFactCountMax,
  );
  const establishedFactReinjectChars = clampInt(
    Math.floor(usableInputTokens * policy.establishedFactReinjectCharsRatio),
    policy.establishedFactReinjectCharsMin,
    policy.establishedFactReinjectCharsMax,
  );
  const memoryReinjectChars = clampInt(
    Math.floor(usableInputTokens * policy.memoryReinjectCharsRatio),
    policy.memoryReinjectCharsMin,
    policy.memoryReinjectCharsMax,
  );

  const windowDerivedFiles = Math.floor(
    (windowTokens * policy.outputRatio) / policy.filesPerOutputTokens,
  );
  const maxUniqueFilesPerCall = clampInt(
    windowDerivedFiles,
    policy.minUniqueFilesPerCall,
    Math.min(policy.maxUniqueFilesPerCallCap, overlay.maxUniqueFilesPerCall),
  );
  if (windowDerivedFiles > overlay.maxUniqueFilesPerCall) {
    reasonCodes.push("mutation_effort_capped");
  }
  const maxPatchesPerCall = clampInt(
    maxUniqueFilesPerCall * 2,
    maxUniqueFilesPerCall,
    policy.maxPatchesPerCallCap,
  );
  const maxPatchPayloadCharacters = Math.max(
    1,
    Math.floor(
      maximumOutputTokens *
        policy.charsPerOutputToken *
        policy.patchPayloadOutputRatio,
    ),
  );

  const maxDiagnosticSteps = clampInt(
    policy.diagnosticStepsBase +
      Math.floor(usableInputTokens / policy.diagnosticStepsPerUsable),
    policy.diagnosticStepsBase,
    policy.diagnosticStepsMax,
  );
  const maxTasks = clampInt(
    policy.maxTasksBase +
      Math.floor(usableInputTokens / policy.maxTasksPerUsable),
    policy.maxTasksBase,
    policy.maxTasksCap,
  );
  const maxModelCalls = overlay.maxModelCalls;
  const maxSkills = clampInt(
    policy.maxSkillsBase +
      Math.floor(usableInputTokens / policy.maxSkillsPerUsable),
    policy.maxSkillsBase,
    policy.maxSkillsCap,
  );
  const maxVerificationChecks = clampInt(
    policy.verificationChecksBase +
      Math.floor(usableInputTokens / policy.verificationChecksPerUsable),
    policy.verificationChecksBase,
    policy.verificationChecksMax,
  );

  const visiblePlanThreshold = Math.min(
    policy.visiblePlanMinUsableTokens,
    Math.max(1, Math.floor(windowTokens * policy.visiblePlanMinUsableRatio)),
  );
  const changeImpactThreshold = Math.min(
    policy.changeImpactMinUsableTokens,
    Math.max(1, Math.floor(windowTokens * policy.changeImpactMinUsableRatio)),
  );

  return windowPolicySchema.parse({
    schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
    contextWindowTokens: windowTokens,
    effort,
    maximumOutputTokens,
    toolSchemaTokens,
    usableInputTokens,
    loopInputBudgetTokens,
    sections: {
      repositoryTokens,
      conversationTokens,
      planTokens,
      skillsTokens,
      systemTokens,
    },
    compaction: {
      warnRatio: policy.compactionWarnRatio,
      autoRatio: policy.compactionAutoRatio,
      hardRatio: policy.compactionHardRatio,
      keepRecentToolResults,
      compactedToolResultChars,
      compactedToolArgumentChars,
      toolResultContentChars,
      droppedTurnSummaryChars,
      establishedFactChars,
      maxEstablishedFacts,
      establishedFactReinjectChars,
      memoryReinjectChars,
      autoMaxTokens: overlay.compactionAutoMaxTokens,
      hardMaxTokens: overlay.compactionHardMaxTokens,
    },
    mutation: {
      maxPatchesPerCall,
      maxUniqueFilesPerCall,
      maxPatchPayloadCharacters,
      preferredBatchSize: maxUniqueFilesPerCall,
      requireBatchedExecution:
        maximumOutputTokens < policy.requireBatchedBelowOutputTokens,
    },
    planning: {
      maxDiagnosticSteps,
      visiblePlanAffordable: usableInputTokens >= visiblePlanThreshold,
      changeImpactAffordable: usableInputTokens >= changeImpactThreshold,
      budgetTokens: planTokens,
    },
    run: {
      maxModelCalls,
      maxToolCalls: overlay.maxToolCalls,
      maxVerificationRepairs: overlay.maxVerificationRepairs,
    },
    skills: {
      budgetTokens: skillsTokens,
      maxSkills,
    },
    taskList: {
      maxTasks,
    },
    maxVerificationChecks,
    resolvedPolicy: policy,
    reasonCodes,
  });
}

function clampInt(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}
