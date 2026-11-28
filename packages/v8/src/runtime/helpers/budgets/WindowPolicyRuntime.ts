import type { ModelRequest } from "../../../modules/model-gateway";
import type { TokenEstimatorPort } from "../../../modules/prompt-construction";
import type { WindowPolicy } from "../../../modules/window-budget";

import type { AgentReasonCode } from "../../../engine/v8-engine/contracts";
import { agentRunBudgetSchema } from "../../../engine/v8-engine/contracts";
import { AGENT_ENGINE_THRESHOLDS } from "../../../engine/v8-engine/legacy/policy";
import {
  isExplorationRereadHeavy,
  type ExplorationRereadThresholds,
} from "../loop-rails/loop-file-reads/LoopFileReads";

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
    /** Prefer this for thrash when present (same-path windowed reads discounted). */
    effectiveFileReadCalls?: number;
  },
  reasonCodes: AgentReasonCode[],
  warnings: string[],
  thresholds: ExplorationRereadThresholds = AGENT_ENGINE_THRESHOLDS,
): void {
  const thrashCalls = snapshot.effectiveFileReadCalls ?? snapshot.fileReadCalls;
  if (
    !isExplorationRereadHeavy(
      {
        fileReadCalls: thrashCalls,
        uniqueFilePathsTouched: snapshot.uniqueFilePathsTouched,
      },
      thresholds,
    )
  ) {
    return;
  }
  if (!reasonCodes.includes("exploration_reread_heavy")) {
    reasonCodes.push("exploration_reread_heavy");
  }
  const warning = `File reads (${thrashCalls} effective / ${snapshot.fileReadCalls} raw) substantially exceeded unique paths (${snapshot.uniqueFilePathsTouched}).`;
  if (!warnings.includes(warning)) {
    warnings.push(warning);
  }
}

/**
 * Map host run budget + Window Policy into soft/hard ceilings.
 *
 * - Soft (`maxModelCalls`): Continue checkpoint — unfinished work should
 *   suspend, not die.
 * - Hard (`hardMaxModelCalls`): absolute safety — never exceed.
 * - `unlimited: true`: working soft may start at hard (host asked for room),
 *   still never above hard.
 */
export function clampRunBudget(
  parsed: ReturnType<typeof agentRunBudgetSchema.parse>,
  windowPolicy: WindowPolicy,
): {
  budget: ReturnType<typeof agentRunBudgetSchema.parse>;
  clamped: Array<{ field: string; requested: number; effective: number }>;
} {
  const softModel = windowPolicy.run.maxModelCalls;
  const hardModel = Math.max(
    softModel,
    windowPolicy.run.hardMaxModelCalls,
  );
  const softTool = windowPolicy.run.maxToolCalls;
  const hardTool = Math.max(softTool, windowPolicy.run.hardMaxToolCalls);
  const softLoop = softModel;
  const hardLoop = hardModel;

  const hardMaxModelCalls = Math.min(
    parsed.hardMaxModelCalls ?? hardModel,
    hardModel,
  );
  const hardMaxToolCalls = Math.min(
    parsed.hardMaxToolCalls ?? hardTool,
    hardTool,
  );
  const hardMaxLoopIterations = Math.min(
    parsed.hardMaxLoopIterations ?? hardLoop,
    hardLoop,
  );

  // Unlimited: allow working soft up to hard (host wants headroom).
  // Limited: start at soft checkpoint; Continue raises toward hard.
  const maxModelCalls = parsed.unlimited
    ? Math.min(Math.max(parsed.maxModelCalls, softModel), hardMaxModelCalls)
    : Math.min(parsed.maxModelCalls, softModel, hardMaxModelCalls);
  const maxToolCalls = parsed.unlimited
    ? Math.min(Math.max(parsed.maxToolCalls, softTool), hardMaxToolCalls)
    : Math.min(parsed.maxToolCalls, softTool, hardMaxToolCalls);
  const maxLoopIterations = parsed.unlimited
    ? Math.min(
        Math.max(parsed.maxLoopIterations, softLoop),
        hardMaxLoopIterations,
      )
    : Math.min(parsed.maxLoopIterations, softLoop, hardMaxLoopIterations);

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
      hardMaxModelCalls,
      maxToolCalls,
      hardMaxToolCalls,
      maxLoopIterations,
      hardMaxLoopIterations,
    },
    clamped,
  };
}
