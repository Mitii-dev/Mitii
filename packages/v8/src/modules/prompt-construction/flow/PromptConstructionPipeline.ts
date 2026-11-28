import type { ModelRequest } from "../../model-gateway";

import { allocateBudget, resolveDynamicOutputTokens } from "./steps";
import { CharacterTokenEstimator } from "../adapters/CharacterTokenEstimator";
import {
  PROMPT_CONSTRUCTION_SCHEMA_VERSION,
  PROMPT_MESSAGES,
  PROMPT_REASON,
  PROMPT_STAGES,
} from "../constants";
import {
  PromptConstructionError,
  promptConstructionInputSchema,
  promptConstructionResultSchema,
  noopModuleLogger,
} from "../contracts";
import type {
  ModuleLoggerPort,
  PromptConstructionInput,
  PromptConstructionResult,
  PromptReasonCode,
  TokenEstimatorPort,
} from "../contracts";
import {
  assembleConversationStage,
  assembleRepositoryStage,
} from "./steps/4-assemble-conversation";
import { assembleSystemStage } from "./steps/2-assemble-system";
import { assembleToolsStage } from "./steps/3-assemble-tools";
import { assembleUserRequestStage } from "./steps/5-assemble-user-request";
import type { PromptAssemblyState } from "../helpers/promptAssemblyState";
import { PROMPT_CONSTRUCTION_THRESHOLDS } from "../rules";

export interface PromptConstructionPipelineOptions {
  tokenEstimator?: TokenEstimatorPort;
  log?: ModuleLoggerPort;
}

/**
 * Prompt Construction facade.
 *
 * Flow (construct):
 *   1-allocate-budget → 2-assemble-system → 3-assemble-tools
 *   → 4-assemble-conversation (+ repository) → 5-assemble-user-request
 *   → 6-resolve-dynamic-output
 */
export class PromptConstructionPipeline {
  private readonly estimator: TokenEstimatorPort;
  private readonly log: ModuleLoggerPort;

  constructor(options: PromptConstructionPipelineOptions = {}) {
    this.estimator = options.tokenEstimator ?? new CharacterTokenEstimator();
    this.log = options.log ?? noopModuleLogger;
  }

  public construct(input: PromptConstructionInput): PromptConstructionResult {
    let parsed: PromptConstructionInput;
    try {
      parsed = promptConstructionInputSchema.parse(input);
    } catch (error) {
      throw new PromptConstructionError(
        "invalid_input",
        PROMPT_MESSAGES.inputInvalid,
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    let stageStartedMs = Date.now();
    const allocation = allocateBudget({
      capabilities: parsed.capabilities,
      outputReserveTokens: parsed.outputReserveTokens,
    });
    this.log.stage({
      module: "prompt-construction",
      stage: PROMPT_STAGES.allocateBudget,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [PROMPT_REASON.outputReservedFirst],
      outputSummary: {
        contextWindowTokens: allocation.contextWindowTokens,
        outputReservedTokens: allocation.outputReservedTokens,
        inputBudgetTokens: allocation.inputBudgetTokens,
      },
    });

    if (
      allocation.inputBudgetTokens <
      PROMPT_CONSTRUCTION_THRESHOLDS.minimumSystemTokens
    ) {
      throw new PromptConstructionError(
        "budget_impossible",
        PROMPT_MESSAGES.budgetImpossible,
        {
          contextWindowTokens: allocation.contextWindowTokens,
          outputReservedTokens: allocation.outputReservedTokens,
          inputBudgetTokens: allocation.inputBudgetTokens,
        },
      );
    }

    const state: PromptAssemblyState = {
      reasonCodes: [PROMPT_REASON.outputReservedFirst],
      warnings: [],
      omissions: [],
      provenance: [],
      sections: allocation.sections,
    };

    stageStartedMs = Date.now();
    const { system, systemContent: coreSystemContent } = assembleSystemStage({
      parsed,
      allocation,
      state,
      estimator: this.estimator,
    });
    this.log.stage({
      module: "prompt-construction",
      stage: PROMPT_STAGES.assembleSystem,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [],
      outputSummary: { systemChars: coreSystemContent.length },
    });

    stageStartedMs = Date.now();
    const { toolsResult, systemContent } = assembleToolsStage({
      parsed,
      state,
      estimator: this.estimator,
      systemContent: coreSystemContent,
    });
    this.log.stage({
      module: "prompt-construction",
      stage: PROMPT_STAGES.assembleTools,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [],
      outputSummary: { toolCount: toolsResult.tools?.length ?? 0 },
    });

    stageStartedMs = Date.now();
    const { conversationBudget, rawUserRequest, conversationResult } =
      assembleConversationStage({
        parsed,
        state,
        estimator: this.estimator,
      });
    const { repositoryContent } = assembleRepositoryStage({
      parsed,
      state,
      estimator: this.estimator,
    });
    this.log.stage({
      module: "prompt-construction",
      stage: PROMPT_STAGES.assembleConversation,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [],
      outputSummary: {
        conversationBudget,
        repositoryChars: repositoryContent.length,
      },
    });

    stageStartedMs = Date.now();
    const { messages, recomputedUsed } = assembleUserRequestStage({
      allocation,
      attachments: input.attachments,
      state,
      estimator: this.estimator,
      system,
      systemContent,
      conversationBudget,
      conversationResult,
      rawUserRequest,
      repositoryContent,
    });
    this.log.stage({
      module: "prompt-construction",
      stage: PROMPT_STAGES.assembleUserRequest,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [],
      outputSummary: {
        messageCount: messages.length,
        usedInputTokens: recomputedUsed,
      },
    });

    const { reasonCodes, warnings, omissions, provenance, sections } = state;

    stageStartedMs = Date.now();
    const dynamicOutput = resolveDynamicOutputTokens({
      contextWindowTokens: allocation.contextWindowTokens,
      configuredOutputTokens: parsed.capabilities.maximumOutputTokens,
      outputReservedTokens: allocation.outputReservedTokens,
      usedInputTokens: recomputedUsed,
    });
    reasonCodes.push(...dynamicOutput.reasonCodes);
    this.log.stage({
      module: "prompt-construction",
      stage: PROMPT_STAGES.resolveDynamicOutput,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: dynamicOutput.reasonCodes,
      outputSummary: {
        maximumOutputTokens: dynamicOutput.maximumOutputTokens,
        availableOutputTokens: dynamicOutput.availableOutputTokens,
      },
    });

    const request: ModelRequest = {
      messages,
      model: parsed.model ?? parsed.capabilities.modelId,
      temperature: parsed.temperature,
      maximumOutputTokens: dynamicOutput.maximumOutputTokens,
      stream: parsed.stream,
      tools: toolsResult.tools,
      toolChoice: toolsResult.toolChoice,
    };

    const withinLimits = recomputedUsed <= allocation.inputBudgetTokens;
    if (withinLimits) {
      reasonCodes.push(PROMPT_REASON.withinProviderLimits);
    } else {
      reasonCodes.push(PROMPT_REASON.blockedRequiredOverflow);
      warnings.push(PROMPT_MESSAGES.exceedsInputBudget);
    }

    const totalOmittedTokens = sections.reduce(
      (sum, entry) => sum + entry.omittedTokens,
      0,
    );
    const totalTruncatedTokens = sections.reduce(
      (sum, entry) => sum + entry.truncatedTokens,
      0,
    );

    const status = !withinLimits
      ? "blocked"
      : omissions.some(
            (item) => item.reason === "budget" || item.reason === "duplicate",
          )
        ? "partial"
        : "complete";

    try {
      return promptConstructionResultSchema.parse({
        schemaVersion: PROMPT_CONSTRUCTION_SCHEMA_VERSION,
        status,
        request,
        budget: {
          contextWindowTokens: allocation.contextWindowTokens,
          outputReservedTokens: allocation.outputReservedTokens,
          inputBudgetTokens: allocation.inputBudgetTokens,
          sections,
          totalUsedTokens: recomputedUsed,
          totalOmittedTokens,
          totalTruncatedTokens,
          withinLimits,
        },
        provenance,
        omissions,
        warnings,
        reasonCodes: uniqueReasonCodes(reasonCodes),
      });
    } catch (error) {
      throw new PromptConstructionError(
        "serialization_failed",
        PROMPT_MESSAGES.resultInvalid,
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
}

function uniqueReasonCodes(
  codes: readonly PromptReasonCode[],
): PromptReasonCode[] {
  return [...new Set(codes)];
}
