import { WINDOW_BUDGET_STAGES } from "../constants";
import type {
  ModuleLoggerPort,
  WindowBudgetInput,
  WindowBudgetPolicyOverrides,
  WindowPolicy,
} from "../contracts";
import { noopModuleLogger } from "../contracts";
import {
  deriveWindowPolicy,
  resolveGenerationCeiling,
  resolvePolicyStep,
} from "./steps";
import { resolveToolLoopMaxOutputTokens } from "../rules";

export interface WindowBudgetPipelineDependencies {
  log?: ModuleLoggerPort;
}

/**
 * Window Budget facade.
 *
 * Flow:
 *   1-resolve-policy → 2-derive-allocation
 *   (optional) 3-resolve-generation-ceiling
 *
 * Publishes soft/hard run *numbers* on WindowPolicy.run. The engine owns
 * loop enforcement (Continue at soft, terminal at hard). Does not own
 * discovery budgets or host context-window detection.
 */
export class WindowBudgetPipeline {
  private readonly log: ModuleLoggerPort;

  constructor(deps: WindowBudgetPipelineDependencies = {}) {
    this.log = deps.log ?? noopModuleLogger;
  }

  /**
   * Derive a full WindowPolicy for an advertised context window.
   */
  public derive(input: WindowBudgetInput): WindowPolicy {
    const { resolved, stage: resolveStage } = resolvePolicyStep({
      contextWindowTokens: input.contextWindowTokens,
      mode: input.mode,
      modelId: input.modelId,
      overrides: input.policy,
    });
    this.log.stage({
      module: "window-budget",
      stage: WINDOW_BUDGET_STAGES.resolvePolicy,
      durationMs: resolveStage.durationMs,
      reasonCodes: resolveStage.reasonCodes,
      inputSummary: {
        contextWindowTokens: input.contextWindowTokens,
        mode: input.mode,
        effort: input.effort,
      },
      outputSummary: {
        band: resolved.band,
        modelProfileId: resolved.modelProfileId,
      },
    });

    const policy = deriveWindowPolicy(input, {
      resolved,
      priorStages: [resolveStage],
      recordStages: true,
    });
    const deriveStage = policy.stages?.[policy.stages.length - 1];
    this.log.stage({
      module: "window-budget",
      stage: WINDOW_BUDGET_STAGES.deriveAllocation,
      durationMs: deriveStage?.durationMs ?? 0,
      reasonCodes: policy.reasonCodes,
      outputSummary: {
        usableInputTokens: policy.usableInputTokens,
        maximumOutputTokens: policy.maximumOutputTokens,
        band: resolved.band,
      },
    });
    return policy;
  }

  public resolveGenerationCeiling(params: {
    contextWindowTokens: number;
    configuredOutputTokens: number;
    reasonCodes?: WindowPolicy["reasonCodes"];
  }): number {
    return resolveGenerationCeiling(params);
  }

  public resolveToolLoopMaxOutputTokens(
    contextWindowTokens: number,
    overrides?: WindowBudgetPolicyOverrides,
  ): number {
    return resolveToolLoopMaxOutputTokens(contextWindowTokens, overrides);
  }
}
