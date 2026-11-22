import type { ModelRequest } from "../../model-gateway";

import { allocateBudget, resolveDynamicOutputTokens } from "../actions";
import { CharacterTokenEstimator } from "../internal/CharacterTokenEstimator";
import { PROMPT_CONSTRUCTION_SCHEMA_VERSION } from "../constants";
import {
  PromptConstructionError,
  promptConstructionInputSchema,
  promptConstructionResultSchema,
} from "../contracts";
import type {
  PromptConstructionInput,
  PromptConstructionResult,
  PromptReasonCode,
  TokenEstimatorPort,
} from "../contracts";
import {
  assembleConversationStage,
  assembleRepositoryStage,
} from "../internal/assembleConversationStage";
import { assembleSystemStage } from "../internal/assembleSystemStage";
import { assembleToolsStage } from "../internal/assembleToolsStage";
import { assembleUserRequestStage } from "../internal/assembleUserRequestStage";
import type { PromptAssemblyState } from "../internal/promptAssemblyState";
import { PROMPT_CONSTRUCTION_THRESHOLDS } from "../policy";

export interface PromptConstructionPipelineOptions {
  tokenEstimator?: TokenEstimatorPort;
}

export class PromptConstructionPipeline {
  private readonly estimator: TokenEstimatorPort;

  constructor(options: PromptConstructionPipelineOptions = {}) {
    this.estimator = options.tokenEstimator ?? new CharacterTokenEstimator();
  }

  public construct(input: PromptConstructionInput): PromptConstructionResult {
    let parsed: PromptConstructionInput;
    try {
      parsed = promptConstructionInputSchema.parse(input);
    } catch (error) {
      throw new PromptConstructionError(
        "invalid_input",
        "Prompt Construction input failed schema validation.",
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const allocation = allocateBudget({
      capabilities: parsed.capabilities,
      outputReserveTokens: parsed.outputReserveTokens,
    });

    if (
      allocation.inputBudgetTokens <
      PROMPT_CONSTRUCTION_THRESHOLDS.minimumSystemTokens
    ) {
      throw new PromptConstructionError(
        "budget_impossible",
        "Provider context window cannot reserve output and still fit required system instructions.",
        {
          contextWindowTokens: allocation.contextWindowTokens,
          outputReservedTokens: allocation.outputReservedTokens,
          inputBudgetTokens: allocation.inputBudgetTokens,
        },
      );
    }

    const state: PromptAssemblyState = {
      reasonCodes: ["output_reserved_first"],
      warnings: [],
      omissions: [],
      provenance: [],
      sections: allocation.sections,
    };


    const { system, systemContent: coreSystemContent } = assembleSystemStage({
      parsed,
      allocation,
      state,
      estimator: this.estimator,
    });
    const { toolsResult, systemContent } = assembleToolsStage({
      parsed,
      state,
      estimator: this.estimator,
      systemContent: coreSystemContent,
    });
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
    const { reasonCodes, warnings, omissions, provenance, sections } = state;

    const dynamicOutput = resolveDynamicOutputTokens({
      contextWindowTokens: allocation.contextWindowTokens,
      configuredOutputTokens: parsed.capabilities.maximumOutputTokens,
      outputReservedTokens: allocation.outputReservedTokens,
      usedInputTokens: recomputedUsed,
    });
    reasonCodes.push(...dynamicOutput.reasonCodes);

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
      reasonCodes.push("within_provider_limits");
    } else {
      reasonCodes.push("blocked_required_overflow");
      warnings.push(
        "Constructed prompt exceeds input budget after required sections; status is blocked.",
      );
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
        "Prompt Construction result failed schema validation.",
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
