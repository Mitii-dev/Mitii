import type { PromptConstructionResult } from "../../../modules/prompt-construction";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { AgentLogVerbosity } from "../internal/logVerbosity";
import { logVerbosityAtLeast } from "../internal/logVerbosity";
import type { EventBus } from "../internal/EventBus";
import type { AgentEngineRuntime } from "./runtime";

/** Emit the `prompt_ready` event summarising prompt budget and window sizing. */
export function emitPromptReady(
  runtime: AgentEngineRuntime,
  params: {
    runId: string;
    bus: EventBus;
    promptResult: PromptConstructionResult;
    windowPolicy: WindowPolicy;
    logVerbosity: AgentLogVerbosity | undefined;
  },
): void {
  const { runId, bus, promptResult, windowPolicy } = params;
  const includePromptDetails = logVerbosityAtLeast(
    params.logVerbosity,
    "standard",
  );
  const planSection = promptResult.budget.sections.find(
    (section) => section.section === "plan",
  );
  const planUsedTokens = planSection?.usedTokens ?? 0;
  runtime.emit(bus, {
    type: "prompt_ready",
    runId,
    status: promptResult.status,
    totalOmittedTokens: promptResult.budget.totalOmittedTokens,
    totalTruncatedTokens: promptResult.budget.totalTruncatedTokens,
    budget: {
      contextWindowTokens: promptResult.budget.contextWindowTokens,
      outputReservedTokens: promptResult.budget.outputReservedTokens,
      inputBudgetTokens: promptResult.budget.inputBudgetTokens,
      totalUsedTokens: promptResult.budget.totalUsedTokens,
      withinLimits: promptResult.budget.withinLimits,
      sections: promptResult.budget.sections.slice(0, 16).map((section) => ({
        section: section.section,
        allocatedTokens: section.allocatedTokens,
        usedTokens: section.usedTokens,
        omittedTokens: section.omittedTokens,
        truncatedTokens: section.truncatedTokens,
      })),
    },
    window: {
      toolSchemaTokens: windowPolicy.toolSchemaTokens,
      usableInputTokens: windowPolicy.usableInputTokens,
      repositoryTokens: windowPolicy.sections.repositoryTokens,
      conversationTokens: windowPolicy.sections.conversationTokens,
      planTokens: planUsedTokens > 0 ? windowPolicy.sections.planTokens : 0,
      planUsedTokens,
      skillsTokens: windowPolicy.sections.skillsTokens,
      systemTokens: windowPolicy.sections.systemTokens,
    },
    ...(includePromptDetails && promptResult.omissions.length > 0
      ? {
          omissions: promptResult.omissions.slice(0, 20).map((omission) => ({
            section: omission.section,
            reason: omission.reason,
            ...(typeof omission.tokens === "number"
              ? { tokens: omission.tokens }
              : {}),
          })),
        }
      : {}),
    ...(includePromptDetails && promptResult.warnings.length > 0
      ? { warnings: promptResult.warnings.slice(0, 20) }
      : {}),
    at: runtime.isoNow(),
  });
}
