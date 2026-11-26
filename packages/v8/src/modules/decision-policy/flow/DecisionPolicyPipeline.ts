import { extractPrimaryUserMessage } from "../../request-understanding";
import {
  DECISION_POLICY_MESSAGES,
  DECISION_POLICY_STAGES,
  DECISION_REASON,
} from "../constants";
import {
  DecisionPolicyError,
  decisionPolicyInputSchema,
  executionDecisionSchema,
} from "../contracts";
import type {
  DecisionPolicyInput,
  ExecutionDecision,
} from "../contracts";
import { toolGrantsEquivalent } from "../helpers";
import {
  resolveMutationProfile,
  resolveRoutePriorityStep,
  uniqueReasonCodes,
} from "../helpers/decisionSupport";
import { narrowToolGrant } from "../helpers/grantAdjustment";
import { attachUnifiedScopes } from "../helpers/AttachUnifiedScopes";
import { applyUpgradePlate } from "../helpers/ApplyUpgradePlate";
import { uniqueStrings } from "../helpers/pathScopes";
import {
  noopModuleLogger,
  type ModuleLoggerPort,
} from "../ports/ModuleLoggerPort";
import { normalizeAndGuard } from "./steps/1-NormalizeAndGuard";
import { resolveRouteAndGate } from "./steps/2-ResolveRouteAndGate";
import { compileGrantAndFences } from "./steps/3-CompileGrantAndFences";
import { emitDecisionAndTrace } from "./steps/4-EmitDecisionAndTrace";

export type DecisionPolicyPipelineDependencies = {
  log?: ModuleLoggerPort;
};

/**
 * Decision Policy facade (S2C-FLOW: 4 stages).
 *
 * Flow (decide):
 *   1-normalize-and-guard → 2-resolve-route-and-gate
 *   → 3-compile-grant-and-fences → 4-emit-decision-and-trace
 */
export class DecisionPolicyPipeline {
  private readonly log: ModuleLoggerPort;

  constructor(dependencies: DecisionPolicyPipelineDependencies = {}) {
    this.log = dependencies.log ?? noopModuleLogger;
  }

  public decide(input: DecisionPolicyInput): ExecutionDecision {
    let parsed: DecisionPolicyInput;
    try {
      parsed = decisionPolicyInputSchema.parse(input);
    } catch (error) {
      throw new DecisionPolicyError(
        "invalid_input",
        DECISION_POLICY_MESSAGES.inputInvalid,
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const mode = parsed.envelope.mode;
    const rawMessage = parsed.envelope.message;
    const message = extractPrimaryUserMessage(rawMessage) || rawMessage;

    let stageStartedMs = Date.now();
    const injection = normalizeAndGuard(rawMessage);
    this.log.stage({
      module: "decision-policy",
      stage: DECISION_POLICY_STAGES.normalizeAndGuard,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: injection.reasonCodes,
      outputSummary: { detected: injection.detected },
    });

    stageStartedMs = Date.now();
    const routePlan = resolveRouteAndGate({ parsed, message });
    this.log.stage({
      module: "decision-policy",
      stage: DECISION_POLICY_STAGES.resolveRouteAndGate,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: routePlan.reasonCodes,
      outputSummary: {
        route: routePlan.route,
        planningDepth: routePlan.planningDepth,
        planGate: routePlan.planGate,
      },
    });

    stageStartedMs = Date.now();
    const grantStage = compileGrantAndFences({
      parsed,
      message,
      routePlan,
      injectionDetected: injection.detected,
      mode,
    });
    this.log.stage({
      module: "decision-policy",
      stage: DECISION_POLICY_STAGES.compileGrantAndFences,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: grantStage.reasonCodes,
      outputSummary: {
        maximumWorkspaceEffect: grantStage.toolGrant.maximumWorkspaceEffect,
        toolCount: grantStage.toolGrant.allowedTools.length,
        clamped: grantStage.clampResult.clamped,
        hasUnifiedScopes: Boolean(grantStage.toolGrant.scopes),
      },
    });

    stageStartedMs = Date.now();
    const { decision, contextReasonCodes } = emitDecisionAndTrace({
      parsed,
      mode,
      routePlan,
      toolGrant: grantStage.toolGrant,
      verification: grantStage.verification,
      clampResult: grantStage.clampResult,
      injection,
      safetyResult: grantStage.safetyResult,
      grantCompiledReasonCodes: grantStage.grantCompiledReasonCodes,
    });
    this.log.stage({
      module: "decision-policy",
      stage: DECISION_POLICY_STAGES.emitDecisionAndTrace,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [...decision.reasonCodes, ...contextReasonCodes],
      outputSummary: {
        route: decision.route,
        runDisposition: decision.runDisposition,
      },
    });

    return decision;
  }

  public narrow(input: {
    previous: ExecutionDecision;
    discoveredPaths?: readonly string[];
    residualRisk?: "low" | "medium" | "high" | "critical";
  }): ExecutionDecision {
    const previous = executionDecisionSchema.parse(input.previous);
    const narrowedGrant = attachUnifiedScopes(
      narrowToolGrant({
        previous: previous.toolGrant,
        discoveredPaths: input.discoveredPaths ?? [],
        residualRisk: input.residualRisk,
        keepWriteWide:
          previous.planningDepth === "visible" ||
          previous.toolGrant.approvalMode === "never",
      }),
    );
    const changed = !toolGrantsEquivalent(previous.toolGrant, narrowedGrant);
    if (!changed) {
      return previous;
    }

    const highRisk =
      input.residualRisk === "high" || input.residualRisk === "critical";
    const reasonCodes = uniqueReasonCodes([
      ...previous.reasonCodes,
      ...(highRisk && narrowedGrant.mutationBudget
        ? ([DECISION_REASON.mutationBudgetTight] as const)
        : []),
      DECISION_REASON.grantNarrowed,
    ]);
    return executionDecisionSchema.parse({
      ...previous,
      toolGrant: narrowedGrant,
      reasonCodes,
      rationale: `${previous.rationale}; grant=narrowed`,
      trace: {
        ...previous.trace,
        routePriorityStep:
          previous.trace?.routePriorityStep ??
          resolveRoutePriorityStep(previous.reasonCodes),
        grantProfile: narrowedGrant.maximumWorkspaceEffect,
        mutationProfile: resolveMutationProfile(reasonCodes),
        clampedByInjection: previous.trace?.clampedByInjection ?? false,
        signalsUsed: uniqueStrings([
          ...(previous.trace?.signalsUsed ?? []),
          "discovered_paths",
          ...(input.residualRisk ? ["residual_risk"] : []),
        ]),
        overrides: [
          ...(previous.trace?.overrides ?? []),
          {
            field: "toolGrant",
            to: "narrowed",
            reasonCode: DECISION_REASON.grantNarrowed,
          },
        ],
      },
    });
  }

  /**
   * Widen only via a registered upgrade plate (S2C-UPGRADE).
   * Casual widen without `upgradePlateId` is rejected.
   */
  public widen(input: {
    previous: ExecutionDecision;
    upgradePlateId: string;
    extraPaths?: readonly string[];
    extraAllowedRoots?: readonly string[];
    extraNetworkHosts?: readonly string[];
  }): ExecutionDecision {
    return applyUpgradePlate({
      previous: input.previous,
      upgradePlateId: input.upgradePlateId,
      extraPaths: (input.extraPaths ?? []).filter((p) => p.trim().length > 0),
      extraAllowedRoots: (input.extraAllowedRoots ?? [])
        .map((root) => root.trim())
        .filter((root) => root.length > 0),
      extraNetworkHosts: (input.extraNetworkHosts ?? [])
        .map((host) => host.trim().toLowerCase())
        .filter((host) => host.length > 0),
    });
  }
}
