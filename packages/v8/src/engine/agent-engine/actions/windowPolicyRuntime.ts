import type { ModelRequest } from "../../../modules/model-gateway";
import type { TokenEstimatorPort } from "../../../modules/prompt-construction";
import type { WindowPolicy } from "../../../modules/window-budget";

import type { AgentReasonCode } from "../contracts";
import { agentRunBudgetSchema } from "../contracts";
import { AGENT_ENGINE_THRESHOLDS } from "../policy";
import {
  isExplorationRereadHeavy,
  type ExplorationRereadThresholds,
} from "./isExplorationRereadHeavy";

export function calculateLoopInputBudgetTokens(params: {
  request: ModelRequest;
  windowPolicy: WindowPolicy;
  estimator: TokenEstimatorPort;
}): number {
  const toolDefinitionTokens =
    params.request.tools && params.request.tools.length > 0
      ? params.estimator.estimate(JSON.stringify(params.request.tools))
      : params.windowPolicy.toolSchemaTokens;
  const rawBudget =
    params.windowPolicy.contextWindowTokens -
    params.windowPolicy.maximumOutputTokens -
    toolDefinitionTokens;
  return Math.max(
    1,
    Math.floor(
      Math.max(0, rawBudget) * params.windowPolicy.resolvedPolicy.loopSafetyRatio,
    ),
  );
}

export function toRunUsage(snapshot: {
  modelCalls: number;
  toolCalls: number;
  loopIterations: number;
  inputTokens: number;
  outputTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  fileReadCalls: number;
  uniqueFilePathsTouched: number;
}) {
  return {
    modelCalls: snapshot.modelCalls,
    toolCalls: snapshot.toolCalls,
    loopIterations: snapshot.loopIterations,
    inputTokens: snapshot.inputTokens,
    outputTokens: snapshot.outputTokens,
    cacheHitTokens: snapshot.cacheHitTokens,
    cacheMissTokens: snapshot.cacheMissTokens,
    fileReadCalls: snapshot.fileReadCalls,
    uniqueFilePathsTouched: snapshot.uniqueFilePathsTouched,
  };
}

export function applyExplorationSignal(
  snapshot: {
    fileReadCalls: number;
    uniqueFilePathsTouched: number;
  },
  reasonCodes: AgentReasonCode[],
  warnings: string[],
  thresholds: ExplorationRereadThresholds = AGENT_ENGINE_THRESHOLDS,
): void {
  if (!isExplorationRereadHeavy(snapshot, thresholds)) {
    return;
  }
  if (!reasonCodes.includes("exploration_reread_heavy")) {
    reasonCodes.push("exploration_reread_heavy");
  }
  const warning = `File reads (${snapshot.fileReadCalls}) substantially exceeded unique paths (${snapshot.uniqueFilePathsTouched}).`;
  if (!warnings.includes(warning)) {
    warnings.push(warning);
  }
}

export function clampRunBudget(
  parsed: ReturnType<typeof agentRunBudgetSchema.parse>,
  windowPolicy: WindowPolicy,
): {
  budget: ReturnType<typeof agentRunBudgetSchema.parse>;
  clamped: Array<{ field: string; requested: number; effective: number }>;
} {
  const maxModelCalls = Math.min(
    parsed.unlimited ? windowPolicy.run.maxModelCalls : parsed.maxModelCalls,
    windowPolicy.run.maxModelCalls,
  );
  const maxToolCalls = Math.min(
    parsed.unlimited ? windowPolicy.run.maxToolCalls : parsed.maxToolCalls,
    windowPolicy.run.maxToolCalls,
  );
  const maxLoopIterations = Math.min(
    parsed.unlimited ? windowPolicy.run.maxModelCalls : parsed.maxLoopIterations,
    windowPolicy.run.maxModelCalls,
  );
  const clamped: Array<{ field: string; requested: number; effective: number }> =
    [];
  if (!parsed.unlimited) {
    if (maxModelCalls < parsed.maxModelCalls) {
      clamped.push({
        field: "maxModelCalls",
        requested: parsed.maxModelCalls,
        effective: maxModelCalls,
      });
    }
    if (maxToolCalls < parsed.maxToolCalls) {
      clamped.push({
        field: "maxToolCalls",
        requested: parsed.maxToolCalls,
        effective: maxToolCalls,
      });
    }
    if (maxLoopIterations < parsed.maxLoopIterations) {
      clamped.push({
        field: "maxLoopIterations",
        requested: parsed.maxLoopIterations,
        effective: maxLoopIterations,
      });
    }
  }
  return {
    budget: {
      ...parsed,
      maxModelCalls,
      maxToolCalls,
      maxLoopIterations,
    },
    clamped,
  };
}
