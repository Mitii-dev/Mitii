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
import { narrowToolGrant, widenToolGrant } from "../helpers/grantAdjustment";
import { uniqueStrings } from "../helpers/pathScopes";
import {
  noopModuleLogger,
  type ModuleLoggerPort,
} from "../ports/ModuleLoggerPort";
import { scanDecisionInjection } from "./steps/1-scan-injection";
import { planDecisionRoute } from "./steps/2-plan-route";
import { compileDecisionGrant } from "./steps/3-compile-grant";
import { clampDecisionGrantAgainstInjection } from "./steps/4-clamp-injection";
import { intersectDecisionSafety } from "./steps/5-intersect-safety";
import { resolveDecisionContext } from "./steps/6-resolve-context";
import { finalizeDecision } from "./steps/7-finalize-decision";

export type DecisionPolicyPipelineDependencies = {
  log?: ModuleLoggerPort;
};

/**
 * Decision Policy facade.
 *
 * Flow (decide):
 *   1-scan-injection → 2-plan-route → 3-compile-grant → 4-clamp-injection
 *   → 5-intersect-safety → 6-resolve-context → 7-finalize-decision
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
    const injection = scanDecisionInjection(rawMessage);
    this.log.stage({
      module: "decision-policy",
      stage: DECISION_POLICY_STAGES.scanInjection,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: injection.reasonCodes,
      outputSummary: { detected: injection.detected },
    });

    stageStartedMs = Date.now();
    const routePlan = planDecisionRoute({ parsed, message });
    this.log.stage({
      module: "decision-policy",
      stage: DECISION_POLICY_STAGES.planRoute,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: routePlan.reasonCodes,
      outputSummary: {
        route: routePlan.route,
        planningDepth: routePlan.planningDepth,
        planGate: routePlan.planGate,
      },
    });

    stageStartedMs = Date.now();
    const grantCompiled = compileDecisionGrant({
      parsed,
      message,
      routePlan,
    });
    this.log.stage({
      module: "decision-policy",
      stage: DECISION_POLICY_STAGES.compileGrant,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: grantCompiled.reasonCodes,
      outputSummary: {
        maximumWorkspaceEffect:
          grantCompiled.toolGrant.maximumWorkspaceEffect,
        toolCount: grantCompiled.toolGrant.allowedTools.length,
      },
    });

    stageStartedMs = Date.now();
    const clampResult = clampDecisionGrantAgainstInjection({
      toolGrant: grantCompiled.toolGrant,
      injectionDetected: injection.detected,
      route: routePlan.route,
      mode,
    });
    this.log.stage({
      module: "decision-policy",
      stage: DECISION_POLICY_STAGES.clampInjection,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [],
      outputSummary: { clamped: clampResult.clamped },
    });

    stageStartedMs = Date.now();
    const safetyResult = intersectDecisionSafety({
      toolGrant: clampResult.toolGrant,
      userSafetyRules: parsed.userSafetyRules,
    });
    this.log.stage({
      module: "decision-policy",
      stage: DECISION_POLICY_STAGES.intersectSafety,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: safetyResult.reasonCodes,
    });

    stageStartedMs = Date.now();
    const { contextResult, hostCapabilityCodes, preflightBuild } =
      resolveDecisionContext({
        parsed,
        routePlan,
        toolGrant: safetyResult.toolGrant,
      });
    this.log.stage({
      module: "decision-policy",
      stage: DECISION_POLICY_STAGES.resolveContext,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [
        ...contextResult.reasonCodes,
        ...hostCapabilityCodes,
        ...preflightBuild.reasonCodes,
      ],
      outputSummary: {
        repositoryContextRequired: contextResult.repositoryContextRequired,
      },
    });

    stageStartedMs = Date.now();
    const decision = finalizeDecision({
      parsed,
      mode,
      routePlan,
      toolGrant: safetyResult.toolGrant,
      verification: grantCompiled.verification,
      clampResult,
      injection,
      safetyResult,
      contextResult,
      hostCapabilityCodes,
      preflightBuild,
      grantCompiledReasonCodes: grantCompiled.reasonCodes,
    });
    this.log.stage({
      module: "decision-policy",
      stage: DECISION_POLICY_STAGES.finalizeDecision,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: decision.reasonCodes,
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
    const narrowedGrant = narrowToolGrant({
      previous: previous.toolGrant,
      discoveredPaths: input.discoveredPaths ?? [],
      residualRisk: input.residualRisk,
      keepWriteWide:
        previous.planningDepth === "visible" ||
        previous.toolGrant.approvalMode === "never",
    });
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
      },
    });
  }

  public widen(input: {
    previous: ExecutionDecision;
    extraPaths?: readonly string[];
    extraAllowedRoots?: readonly string[];
    extraNetworkHosts?: readonly string[];
  }): ExecutionDecision {
    const previous = executionDecisionSchema.parse(input.previous);
    const extraPaths = (input.extraPaths ?? []).filter(
      (path) => path.trim().length > 0,
    );
    const extraAllowedRoots = (input.extraAllowedRoots ?? [])
      .map((root) => root.trim())
      .filter((root) => root.length > 0);
    const extraNetworkHosts = (input.extraNetworkHosts ?? [])
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host.length > 0);
    if (
      extraPaths.length === 0 &&
      extraAllowedRoots.length === 0 &&
      extraNetworkHosts.length === 0
    ) {
      return previous;
    }
    const widenedGrant = widenToolGrant({
      previous: previous.toolGrant,
      extraPaths,
      extraAllowedRoots,
      extraNetworkHosts,
    });
    if (toolGrantsEquivalent(previous.toolGrant, widenedGrant)) {
      return previous;
    }
    const reasonCodes = uniqueReasonCodes([
      ...previous.reasonCodes,
      DECISION_REASON.grantExpanded,
    ]);
    return executionDecisionSchema.parse({
      ...previous,
      toolGrant: widenedGrant,
      reasonCodes,
      rationale: `${previous.rationale}; grant=expanded`,
      trace: {
        ...previous.trace,
        routePriorityStep:
          previous.trace?.routePriorityStep ??
          resolveRoutePriorityStep(previous.reasonCodes),
        grantProfile: widenedGrant.maximumWorkspaceEffect,
        mutationProfile: resolveMutationProfile(reasonCodes),
        clampedByInjection: previous.trace?.clampedByInjection ?? false,
        signalsUsed: uniqueStrings([
          ...(previous.trace?.signalsUsed ?? []),
          "grant_expanded",
        ]),
      },
    });
  }
}
