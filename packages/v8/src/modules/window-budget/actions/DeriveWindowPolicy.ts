import { WINDOW_BUDGET_SCHEMA_VERSION } from "../constants";
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
import { mergeWindowBudgetPolicy } from "../policy";

/**
 * Derive a complete window allocation from advertised capabilities.
 * Tool schemas are a fixed cost; remaining usable input is split by policy shares.
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

  const policy = mergeWindowBudgetPolicy(parsed.policy);
  const windowTokens = parsed.contextWindowTokens;
  const reasonCodes: WindowBudgetReasonCode[] = [];

  const derivedOutput = clampInt(
    Math.floor(windowTokens * policy.outputRatio),
    policy.outputMinTokens,
    Math.min(
      policy.outputMaxTokens,
      Math.max(1, Math.floor(windowTokens * policy.outputWindowCapRatio)),
      Math.max(1, windowTokens - 1),
    ),
  );

  const hostOutput = parsed.maximumOutputTokens ?? 0;
  const maximumOutputTokens =
    hostOutput > 0
      ? clampInt(hostOutput, 1, Math.max(1, windowTokens - 1))
      : derivedOutput;
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

  const repositoryTokens = Math.min(
    policy.repositoryTokensCap,
    Math.floor(usableInputTokens * policy.repositoryShare),
  );
  const conversationTokens = Math.floor(
    usableInputTokens * policy.conversationShare,
  );
  const planTokens = clampInt(
    Math.floor(usableInputTokens * policy.planShare),
    1,
    policy.planTokensCap,
  );
  const skillsTokens = clampInt(
    Math.floor(usableInputTokens * policy.skillsShare),
    1,
    policy.skillsTokensCap,
  );
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

  const maxUniqueFilesPerCall = clampInt(
    Math.floor(maximumOutputTokens / policy.filesPerOutputTokens),
    policy.minUniqueFilesPerCall,
    policy.maxUniqueFilesPerCallCap,
  );
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
  const maxModelCalls = clampInt(
    Math.floor(usableInputTokens / policy.maxModelCallsPerUsable),
    policy.maxModelCallsMin,
    policy.maxModelCallsMax,
  );
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
      maxToolCalls: maxModelCalls * 2,
    },
    skills: {
      budgetTokens: skillsTokens,
      maxSkills,
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
