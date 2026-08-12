import {
  buildToolGrant,
  resolvePlanGate,
  resolvePlanningDepth,
  resolveRoute,
  resolveVerificationRequirement,
  scanPromptInjection,
} from "../actions";
import { DECISION_POLICY_SCHEMA_VERSION } from "../constants";
import {
  DecisionPolicyError,
  decisionPolicyInputSchema,
  executionDecisionSchema,
} from "../contracts";
import type {
  DecisionPolicyInput,
  DecisionReasonCode,
  DecisionTrace,
  ExecutionDecision,
  MutationBudget,
  ToolGrant,
} from "../contracts";
import { extractPrimaryUserMessage } from "../../request-understanding/intent/extractPrimaryUserMessage";

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
    const routeResult = resolveRoute({ mode, understanding, message });
    const depthResult = resolvePlanningDepth({
      mode,
      route: routeResult.route,
      understanding,
      message,
    });
    const resolvedPlanGateResult = resolvePlanGate({
      mode,
      route: routeResult.route,
      planningDepth: depthResult.planningDepth,
      understanding,
    });
    const planGateResult =
      parsed.planApproval === "never"
        ? { planGate: "none" as const, reasonCodes: ["plan_gate_none" as const] }
        : resolvedPlanGateResult;
    const grantResult = buildToolGrant({
      mode,
      route: routeResult.route,
      understanding,
      message,
      approvalMode: parsed.approvalMode,
      allowWebSearch: parsed.hostCapabilities?.webSearch === true,
    });

    // Injection must never broaden the grant. Clamp write away if injection
    // tried to force mutation outside an authorized execute route.
    const clampResult = clampGrantAgainstInjection(
      grantResult.toolGrant,
      injection.detected,
      routeResult.route,
      mode,
    );
    const toolGrant = clampResult.toolGrant;

    const verificationResult = resolveVerificationRequirement({
      route: routeResult.route,
      mode,
      understanding,
      maximumWorkspaceEffect: toolGrant.maximumWorkspaceEffect,
    });

    const contextResult = resolveRepositoryContextNeed({
      route: routeResult.route,
      understanding,
      repositoryState: parsed.repositoryState,
    });

    const reasonCodes = uniqueReasonCodes([
      ...routeResult.reasonCodes,
      ...depthResult.reasonCodes,
      ...planGateResult.reasonCodes,
      ...grantResult.reasonCodes,
      ...verificationResult.reasonCodes,
      ...contextResult.reasonCodes,
      ...injection.reasonCodes,
    ]);
    const trace = buildDecisionTrace({
      reasonCodes,
      grant: toolGrant,
      clampedByInjection: clampResult.clamped,
      understanding,
    });

    const decision = executionDecisionSchema.parse({
      schemaVersion: DECISION_POLICY_SCHEMA_VERSION,
      route: routeResult.route,
      planningDepth: depthResult.planningDepth,
      planGate: planGateResult.planGate,
      runDisposition: routeResult.runDisposition,
      repositoryContextRequired: contextResult.repositoryContextRequired,
      pinnedState: contextResult.pinnedState,
      toolGrant,
      verification: verificationResult.verification,
      reasonCodes,
      rationale: buildRationale({
        route: routeResult.route,
        planningDepth: depthResult.planningDepth,
        planGate: planGateResult.planGate,
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
    });
    const changed = !sameGrant(previous.toolGrant, narrowedGrant);
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
}

function resolveRepositoryContextNeed(params: {
  route: ExecutionDecision["route"];
  understanding: DecisionPolicyInput["understanding"];
  repositoryState: DecisionPolicyInput["repositoryState"];
}): {
  repositoryContextRequired: boolean;
  pinnedState: ExecutionDecision["pinnedState"];
  reasonCodes: DecisionReasonCode[];
  warnings: string[];
} {
  const { route, understanding, repositoryState } = params;
  const reasonCodes: DecisionReasonCode[] = [];
  const warnings: string[] = [];

  const repositoryContextRequired =
    route === "repository_answer" ||
    route === "diagnose" ||
    route === "plan" ||
    route === "execute" ||
    understanding.taskAnalysis.recommendsRepositoryDiscovery;

  if (repositoryContextRequired) {
    reasonCodes.push("repository_context_required");
  }

  const readiness = repositoryState?.readiness;
  if (repositoryContextRequired && readiness === "degraded") {
    reasonCodes.push("repository_state_degraded");
    warnings.push(
      "Pinned repository state is degraded; context may be incomplete.",
    );
  }
  if (repositoryContextRequired && readiness === "unavailable") {
    reasonCodes.push("repository_state_unavailable");
    warnings.push(
      "Repository state is unavailable; repository-grounded work may be blocked by the engine.",
    );
  }

  return {
    repositoryContextRequired,
    pinnedState: repositoryState?.reference,
    reasonCodes,
    warnings,
  };
}

function clampGrantAgainstInjection(
  grant: ExecutionDecision["toolGrant"],
  injectionDetected: boolean,
  route: ExecutionDecision["route"],
  mode: DecisionPolicyInput["envelope"]["mode"],
): { toolGrant: ExecutionDecision["toolGrant"]; clamped: boolean } {
  if (!injectionDetected) {
    return { toolGrant: grant, clamped: false };
  }

  // Never allow injection to produce write authority outside agent execute.
  if (mode !== "agent" || route !== "execute") {
    if (grant.maximumWorkspaceEffect === "write") {
      return {
        clamped: true,
        toolGrant: {
          ...grant,
          maximumWorkspaceEffect: "read",
          allowedTools: grant.allowedTools.filter(
            (tool) =>
              tool !== "apply_patch" &&
              tool !== "delete_file" &&
              tool !== "delete_directory" &&
              tool !== "move_file" &&
              tool !== "run_command",
          ),
          allowedEffects: grant.allowedEffects.filter(
            (effect) =>
              effect !== "workspace_write" &&
              effect !== "git_write" &&
              effect !== "external_write" &&
              effect !== "network_access" &&
              effect !== "secret_use",
          ),
          approvalMode: "never",
          networkHosts: [],
          mutationBudget: undefined,
        },
      };
    }
  }

  // Even on execute, injection never adds network/git/external/secret effects.
  return {
    clamped: true,
    toolGrant: {
      ...grant,
      allowedEffects: grant.allowedEffects.filter(
        (effect) =>
          effect !== "git_write" &&
          effect !== "external_write" &&
          effect !== "network_access" &&
          effect !== "secret_use",
      ),
      networkHosts: [],
    },
  };
}

function uniqueReasonCodes(
  codes: readonly DecisionReasonCode[],
): DecisionReasonCode[] {
  return [...new Set(codes)];
}

function buildRationale(params: {
  route: ExecutionDecision["route"];
  planningDepth: ExecutionDecision["planningDepth"];
  planGate: ExecutionDecision["planGate"];
  mode: DecisionPolicyInput["envelope"]["mode"];
  reasonCodes: readonly DecisionReasonCode[];
}): string {
  const { route, planningDepth, planGate, mode, reasonCodes } = params;
  return `mode=${mode}; route=${route}; planningDepth=${planningDepth}; planGate=${planGate}; reasons=${reasonCodes.join(",")}`;
}

function buildDecisionTrace(params: {
  reasonCodes: readonly DecisionReasonCode[];
  grant: ToolGrant;
  clampedByInjection: boolean;
  understanding: DecisionPolicyInput["understanding"];
}): DecisionTrace {
  return {
    routePriorityStep: resolveRoutePriorityStep(params.reasonCodes),
    grantProfile: params.grant.maximumWorkspaceEffect,
    mutationProfile: resolveMutationProfile(params.reasonCodes),
    clampedByInjection: params.clampedByInjection,
    signalsUsed: uniqueStrings([
      `primary:${params.understanding.intent.classification.primaryTaskIntent}`,
      `interaction:${params.understanding.intent.classification.interactionIntent}`,
      `scope:${params.understanding.taskAnalysis.scope}`,
      `risk:${params.understanding.taskAnalysis.risk}`,
      `clarity:${params.understanding.taskAnalysis.clarity}`,
      ...params.reasonCodes.slice(0, 12),
    ]),
  };
}

function resolveRoutePriorityStep(
  reasonCodes: readonly DecisionReasonCode[],
): string {
  const priority = [
    "clarification_material",
    "mode_ask_readonly",
    "mode_plan_only",
    "explicit_plan_request",
    "diagnosis_readonly",
    "mutation_execute",
    "workspace_bug_execute",
    "repository_grounded_answer",
    "direct_knowledge_answer",
  ];
  return (
    priority.find((code) =>
      reasonCodes.includes(code as DecisionReasonCode),
    ) ?? reasonCodes[0] ?? "unknown"
  );
}

function resolveMutationProfile(
  reasonCodes: readonly DecisionReasonCode[],
): DecisionTrace["mutationProfile"] {
  if (reasonCodes.includes("mutation_budget_tight")) {
    return "tight";
  }
  if (reasonCodes.includes("mutation_budget_relaxed")) {
    return "relaxed";
  }
  if (reasonCodes.includes("mutation_budget_standard")) {
    return "standard";
  }
  return "none";
}

function narrowToolGrant(params: {
  previous: ToolGrant;
  discoveredPaths: readonly string[];
  residualRisk?: "low" | "medium" | "high" | "critical";
}): ToolGrant {
  const previous = params.previous;
  const narrowedScopes = narrowPathScopes(
    previous.pathScopes,
    params.discoveredPaths,
  );
  const highRisk =
    params.residualRisk === "high" || params.residualRisk === "critical";
  return {
    ...previous,
    pathScopes: narrowedScopes,
    approvalMode: highRisk ? "every_mutation" : previous.approvalMode,
    mutationBudget:
      highRisk && previous.mutationBudget
        ? tightenMutationBudget(previous.mutationBudget)
        : previous.mutationBudget,
  };
}

function narrowPathScopes(
  previousScopes: readonly string[],
  discoveredPaths: readonly string[],
): string[] {
  const discoveredScopes = uniqueStrings(
    discoveredPaths
      .map(parentScopeFromPath)
      .filter((path): path is string => Boolean(path)),
  );
  if (discoveredScopes.length === 0) {
    return [...previousScopes];
  }

  const narrowed = new Set<string>();
  for (const previous of previousScopes) {
    const normalizedPrevious = normalizeScope(previous);
    for (const discovered of discoveredScopes) {
      if (scopeContains(normalizedPrevious, discovered)) {
        narrowed.add(discovered);
      } else if (scopeContains(discovered, normalizedPrevious)) {
        narrowed.add(normalizedPrevious);
      }
    }
  }

  return narrowed.size > 0
    ? [...narrowed].sort((a, b) => a.localeCompare(b))
    : [...previousScopes];
}

function parentScopeFromPath(value: string): string | undefined {
  const normalized = normalizeScope(value);
  if (
    !normalized ||
    normalized.includes("..") ||
    normalized.startsWith("/") ||
    normalized.startsWith("~") ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    return undefined;
  }
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

function normalizeScope(value: string): string {
  return value
    .trim()
    .replace(/^@+/, "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "") || ".";
}

function scopeContains(parent: string, child: string): boolean {
  if (parent === ".") {
    return true;
  }
  if (child === ".") {
    return parent === ".";
  }
  return child === parent || child.startsWith(`${parent}/`);
}

function tightenMutationBudget(budget: MutationBudget): MutationBudget {
  return {
    maxPatchesPerCall: Math.max(1, Math.min(budget.maxPatchesPerCall, 3)),
    maxUniqueFilesPerCall: Math.max(
      1,
      Math.min(budget.maxUniqueFilesPerCall, 2),
    ),
    maxPatchPayloadCharacters: Math.max(
      1,
      Math.min(budget.maxPatchPayloadCharacters, 18_000),
    ),
    preferredBatchSize: Math.max(1, Math.min(budget.preferredBatchSize, 1)),
    requireBatchedExecution: true,
  };
}

function sameGrant(a: ToolGrant, b: ToolGrant): boolean {
  return JSON.stringify(normalizeGrantForCompare(a)) ===
    JSON.stringify(normalizeGrantForCompare(b));
}

function normalizeGrantForCompare(grant: ToolGrant): ToolGrant {
  return {
    ...grant,
    allowedTools: [...grant.allowedTools].sort(),
    allowedEffects: [...grant.allowedEffects].sort(),
    pathScopes: [...grant.pathScopes].sort(),
    networkHosts: grant.networkHosts ? [...grant.networkHosts].sort() : undefined,
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
