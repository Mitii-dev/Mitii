import { EXECUTION_ROUTE } from "../constants";
import type {
  DecisionPolicyInput,
  DecisionReasonCode,
  DecisionTrace,
  ExecutionDecision,
  ToolGrant,
} from "../contracts";
import { uniqueStrings } from "./pathScopes";

export function resolveRepositoryContextNeed(params: {
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
    route === EXECUTION_ROUTE.REPOSITORY_ANSWER ||
    route === EXECUTION_ROUTE.DIAGNOSE ||
    route === EXECUTION_ROUTE.PLAN ||
    route === EXECUTION_ROUTE.EXECUTE ||
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

export function resolveHostCapabilityReasonCodes(
  hostCapabilities: DecisionPolicyInput["hostCapabilities"],
): DecisionReasonCode[] {
  if (!hostCapabilities) {
    return [];
  }
  const codes: DecisionReasonCode[] = [];
  if (hostCapabilities.diagnostics === true) {
    codes.push("diagnostics_port_available");
  }
  switch (hostCapabilities.codeNavigation) {
    case "available":
      codes.push("code_navigation_available");
      break;
    case "degraded":
      codes.push("code_navigation_degraded");
      break;
    case "unavailable":
      codes.push("code_navigation_unavailable");
      break;
    default:
      break;
  }
  return codes;
}

export function clampGrantAgainstInjection(
  grant: ExecutionDecision["toolGrant"],
  injectionDetected: boolean,
  route: ExecutionDecision["route"],
  mode: DecisionPolicyInput["envelope"]["mode"],
): { toolGrant: ExecutionDecision["toolGrant"]; clamped: boolean } {
  if (!injectionDetected) {
    return { toolGrant: grant, clamped: false };
  }

  // Never allow injection to produce write authority outside agent execute.
  if (mode !== "agent" || route !== EXECUTION_ROUTE.EXECUTE) {
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
              tool !== "run_command" &&
              tool !== "git_signoff_range",
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
      allowedTools: grant.allowedTools.filter(
        (tool) => tool !== "git_signoff_range",
      ),
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

export function uniqueReasonCodes(
  codes: readonly DecisionReasonCode[],
): DecisionReasonCode[] {
  return [...new Set(codes)];
}

export function buildRationale(params: {
  route: ExecutionDecision["route"];
  planningDepth: ExecutionDecision["planningDepth"];
  planGate: ExecutionDecision["planGate"];
  mode: DecisionPolicyInput["envelope"]["mode"];
  reasonCodes: readonly DecisionReasonCode[];
}): string {
  const { route, planningDepth, planGate, mode, reasonCodes } = params;
  return `mode=${mode}; route=${route}; planningDepth=${planningDepth}; planGate=${planGate}; reasons=${reasonCodes.join(",")}`;
}

export function buildDecisionTrace(params: {
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
      ...(params.understanding.intent.diagnostics?.llmPrimaryIntent
        ? [
            `llmPrimary:${params.understanding.intent.diagnostics.llmPrimaryIntent}`,
            `llmInteraction:${params.understanding.intent.diagnostics.llmInteractionIntent}`,
          ]
        : []),
      `scope:${params.understanding.taskAnalysis.scope}`,
      `risk:${params.understanding.taskAnalysis.risk}`,
      `clarity:${params.understanding.taskAnalysis.clarity}`,
      ...params.reasonCodes.slice(0, 12),
    ]),
  };
}

export function resolveRoutePriorityStep(
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

export function resolveMutationProfile(
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
