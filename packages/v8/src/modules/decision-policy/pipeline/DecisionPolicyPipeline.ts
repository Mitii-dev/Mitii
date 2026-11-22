import {
  compileGrant,
  intersectUserSafetyRules,
  planRoute,
  resolvePreflightBuild,
  scanPromptInjection,
  toolGrantsEquivalent,
} from "../actions";
import { DECISION_POLICY_SCHEMA_VERSION } from "../constants";
import {
  DecisionPolicyError,
  decisionPolicyInputSchema,
  executionDecisionSchema,
} from "../contracts";
import type {
  DecisionPolicyInput,
  ExecutionDecision,
} from "../contracts";
import { extractPrimaryUserMessage } from "../../request-understanding";
import { isContinuationTurnKind } from "../../request-understanding";
import {
  buildDecisionTrace,
  buildRationale,
  clampGrantAgainstInjection,
  resolveHostCapabilityReasonCodes,
  resolveMutationProfile,
  resolveRepositoryContextNeed,
  resolveRoutePriorityStep,
  uniqueReasonCodes,
} from "../internal/decisionSupport";
import { narrowToolGrant, widenToolGrant } from "../internal/grantAdjustment";
import { uniqueStrings } from "../internal/pathScopes";

export class DecisionPolicyPipeline {
  public decide(input: DecisionPolicyInput): ExecutionDecision {
    let parsed: DecisionPolicyInput;
    try {
      parsed = decisionPolicyInputSchema.parse(input);
    } catch (error) {
      throw new DecisionPolicyError(
        "invalid_input",
        "Decision Policy input failed schema validation.",
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const mode = parsed.envelope.mode;
    const rawMessage = parsed.envelope.message;
    // Route heuristics must see the primary ask, not host-wrapped context.
    const message = extractPrimaryUserMessage(rawMessage) || rawMessage;
    const understanding = parsed.understanding;

    const injection = scanPromptInjection(rawMessage);
    const routePlan = planRoute({
      mode,
      understanding,
      message,
      planApproval: parsed.planApproval,
      windowPolicy: parsed.windowPolicy,
      origin: parsed.envelope.origin,
      // undefined/true → facts-first when high-confidence; false = kill-switch.
      policyFactsFirst: parsed.policyFactsFirst,
      turnKind: parsed.envelope.turnKind,
      requiredMcpServerIds: parsed.requiredMcpServerIds,
    });
    const grantCompiled = compileGrant({
      mode,
      route: routePlan.route,
      understanding,
      message,
      approvalMode: parsed.approvalMode,
      allowWebSearch: parsed.hostCapabilities?.webSearch === true,
      windowPolicy: parsed.windowPolicy,
      requiredMcpServerIds: parsed.requiredMcpServerIds,
    });

    // Injection must never broaden the grant. Clamp write away if injection
    // tried to force mutation outside an authorized execute route.
    const clampResult = clampGrantAgainstInjection(
      grantCompiled.toolGrant,
      injection.detected,
      routePlan.route,
      mode,
    );

    // User safety rules: tighten-only intersect after mode seals + injection clamp.
    const safetyResult = intersectUserSafetyRules(
      clampResult.toolGrant,
      parsed.userSafetyRules,
    );
    const toolGrant = safetyResult.toolGrant;

    const contextResult = resolveRepositoryContextNeed({
      route: routePlan.route,
      understanding,
      repositoryState: parsed.repositoryState,
    });
    const hostCapabilityCodes = resolveHostCapabilityReasonCodes(
      parsed.hostCapabilities,
    );
    const preflightBuild = resolvePreflightBuild({
      mode,
      route: routePlan.route,
      understanding,
      grant: toolGrant,
    });

    const reasonCodes = uniqueReasonCodes([
      ...routePlan.reasonCodes,
      ...grantCompiled.reasonCodes,
      ...contextResult.reasonCodes,
      ...hostCapabilityCodes,
      ...preflightBuild.reasonCodes,
      ...injection.reasonCodes,
      ...safetyResult.reasonCodes,
      ...(isContinuationTurnKind(parsed.envelope.turnKind)
        ? (["turn_continuation"] as const)
        : []),
    ]);
    const trace = buildDecisionTrace({
      reasonCodes,
      grant: toolGrant,
      clampedByInjection: clampResult.clamped,
      understanding,
    });

    const decision = executionDecisionSchema.parse({
      schemaVersion: DECISION_POLICY_SCHEMA_VERSION,
      route: routePlan.route,
      planningDepth: routePlan.planningDepth,
      planGate: routePlan.planGate,
      runDisposition: routePlan.runDisposition,
      repositoryContextRequired: contextResult.repositoryContextRequired,
      pinnedState: contextResult.pinnedState,
      toolGrant,
      verification: grantCompiled.verification,
      reasonCodes,
      rationale: buildRationale({
        route: routePlan.route,
        planningDepth: routePlan.planningDepth,
        planGate: routePlan.planGate,
        mode,
        reasonCodes,
      }),
      warnings: [...injection.warnings, ...contextResult.warnings],
      trace,
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
      // Visible plans and full-access (approval never) keep workspace-wide
      // mutation so required out-of-discovery paths stay writable.
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
        ? (["mutation_budget_tight"] as const)
        : []),
      "grant_narrowed",
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

  /**
   * Expand read (and write, when already granted) scopes to include extra
   * paths after path_out_of_scope or compiler errors outside the current grant.
   * Also merges hosts discovered from web_search results for follow-up fetch_url.
   */
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
      "grant_expanded",
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
