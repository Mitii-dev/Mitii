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
    const routePlan = planRoute({
      mode,
      understanding,
      message,
      planApproval: parsed.planApproval,
      windowPolicy: parsed.windowPolicy,
      origin: parsed.envelope.origin,
    });
    const grantCompiled = compileGrant({
      mode,
      route: routePlan.route,
      understanding,
      message,
      approvalMode: parsed.approvalMode,
      allowWebSearch: parsed.hostCapabilities?.webSearch === true,
      windowPolicy: parsed.windowPolicy,
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
      ...preflightBuild.reasonCodes,
      ...injection.reasonCodes,
      ...safetyResult.reasonCodes,
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
   */
  public widen(input: {
    previous: ExecutionDecision;
    extraPaths?: readonly string[];
  }): ExecutionDecision {
    const previous = executionDecisionSchema.parse(input.previous);
    const extraPaths = (input.extraPaths ?? []).filter(
      (path) => path.trim().length > 0,
    );
    if (extraPaths.length === 0) {
      return previous;
    }
    const widenedGrant = widenToolGrant({
      previous: previous.toolGrant,
      extraPaths,
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
    "verification_run_requested",
    "mutation_execute",
    "workspace_bug_execute",
    "workspace_symptom_diagnose",
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
  keepWriteWide?: boolean;
}): ToolGrant {
  const previous = params.previous;
  const highRisk =
    params.residualRisk === "high" || params.residualRisk === "critical";
  const keepWorkspaceRead = previous.pathScopes.includes(".");
  const narrowedReadScopes = keepWorkspaceRead
    ? [...previous.pathScopes]
    : narrowPathScopes(previous.pathScopes, params.discoveredPaths);

  let mutationPathScopes = previous.mutationPathScopes;
  if (previous.maximumWorkspaceEffect === "write" && !params.keepWriteWide) {
    if (previous.mutationPathScopes && previous.mutationPathScopes.length > 0) {
      mutationPathScopes = preserveWorkspaceRootMutationScope(
        previous.mutationPathScopes,
        narrowPathScopes(
          previous.mutationPathScopes,
          params.discoveredPaths,
        ),
      );
    } else if (params.discoveredPaths.length > 0) {
      const discoveredWrite = narrowPathScopes(["."], params.discoveredPaths);
      mutationPathScopes =
        discoveredWrite.length > 0 ? discoveredWrite : previous.mutationPathScopes;
    }
  }

  return {
    ...previous,
    pathScopes: narrowedReadScopes,
    mutationPathScopes,
    // Host "never" (Full access / guided auto-approve) must survive residual
    // risk elevation; otherwise apply_patch keeps demanding approval.
    approvalMode:
      previous.approvalMode === "never"
        ? "never"
        : highRisk
          ? "every_mutation"
          : previous.approvalMode,
    mutationBudget:
      highRisk && previous.mutationBudget
        ? tightenMutationBudget(previous.mutationBudget)
        : previous.mutationBudget,
  };
}

function widenToolGrant(params: {
  previous: ToolGrant;
  extraPaths: readonly string[];
}): ToolGrant {
  const extraScopes = deriveDiscoveredScopes(params.extraPaths);
  if (extraScopes.length === 0) {
    return params.previous;
  }

  const pathScopes = params.previous.pathScopes.includes(".")
    ? [...params.previous.pathScopes]
    : uniqueStrings([...params.previous.pathScopes, ...extraScopes]);

  const mutationPathScopes =
    params.previous.maximumWorkspaceEffect === "write"
      ? uniqueStrings([
          ...(params.previous.mutationPathScopes ?? []),
          ...extraScopes,
        ])
      : params.previous.mutationPathScopes;

  return {
    ...params.previous,
    pathScopes,
    mutationPathScopes:
      mutationPathScopes && mutationPathScopes.length > 0
        ? mutationPathScopes
        : params.previous.mutationPathScopes,
  };
}

function preserveWorkspaceRootMutationScope(
  previousScopes: readonly string[],
  narrowedScopes: readonly string[],
): string[] {
  const hadWorkspaceRoot = previousScopes.some(
    (scope) => normalizeScope(scope) === ".",
  );
  if (!hadWorkspaceRoot) {
    return [...narrowedScopes];
  }
  return uniqueStrings([".", ...narrowedScopes]);
}

function narrowPathScopes(
  previousScopes: readonly string[],
  discoveredPaths: readonly string[],
): string[] {
  const discoveredScopes = deriveDiscoveredScopes(discoveredPaths);
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

function deriveDiscoveredScopes(discoveredPaths: readonly string[]): string[] {
  return uniqueStrings(
    discoveredPaths
      .map((path) => projectScopeFromPath(path) ?? parentScopeFromPath(path))
      .filter((path): path is string => Boolean(path)),
  );
}

function projectScopeFromPath(value: string): string | undefined {
  const normalized = normalizeScope(value);
  if (!isSafeRelativeScope(normalized)) {
    return undefined;
  }

  const parts = normalized.split("/");
  const workspaceContainer = parts[0];
  const projectName = parts[1];
  if (
    projectName &&
    (workspaceContainer === "packages" || workspaceContainer === "apps")
  ) {
    return `${workspaceContainer}/${projectName}`;
  }

  return undefined;
}

function parentScopeFromPath(value: string): string | undefined {
  const normalized = normalizeScope(value);
  if (!isSafeRelativeScope(normalized)) {
    return undefined;
  }
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

function isSafeRelativeScope(normalized: string): boolean {
  return (
    Boolean(normalized) &&
    !normalized.includes("..") &&
    !normalized.startsWith("/") &&
    !normalized.startsWith("~") &&
    !/^[A-Za-z]:\//.test(normalized)
  );
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

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
