import {
  buildToolGrant,
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
  ExecutionDecision,
} from "../contracts";

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
    const message = parsed.envelope.message;
    const understanding = parsed.understanding;

    const injection = scanPromptInjection(message);
    const routeResult = resolveRoute({ mode, understanding, message });
    const depthResult = resolvePlanningDepth({
      mode,
      route: routeResult.route,
      understanding,
      message,
    });
    const grantResult = buildToolGrant({
      mode,
      route: routeResult.route,
      understanding,
    });

    // Injection must never broaden the grant. Clamp write away if injection
    // tried to force mutation outside an authorized execute route.
    const toolGrant = clampGrantAgainstInjection(
      grantResult.toolGrant,
      injection.detected,
      routeResult.route,
      mode,
    );

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
      ...grantResult.reasonCodes,
      ...verificationResult.reasonCodes,
      ...contextResult.reasonCodes,
      ...injection.reasonCodes,
    ]);

    const decision = executionDecisionSchema.parse({
      schemaVersion: DECISION_POLICY_SCHEMA_VERSION,
      route: routeResult.route,
      planningDepth: depthResult.planningDepth,
      runDisposition: routeResult.runDisposition,
      repositoryContextRequired: contextResult.repositoryContextRequired,
      pinnedState: contextResult.pinnedState,
      toolGrant,
      verification: verificationResult.verification,
      reasonCodes,
      rationale: buildRationale({
        route: routeResult.route,
        planningDepth: depthResult.planningDepth,
        mode,
        reasonCodes,
      }),
      warnings: [...injection.warnings, ...contextResult.warnings],
    });

    return decision;
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
): ExecutionDecision["toolGrant"] {
  if (!injectionDetected) {
    return grant;
  }

  // Never allow injection to produce write authority outside agent execute.
  if (mode !== "agent" || route !== "execute") {
    if (grant.maximumWorkspaceEffect === "write") {
      return {
        ...grant,
        maximumWorkspaceEffect: "read",
        allowedTools: grant.allowedTools.filter(
          (tool) => tool !== "apply_patch" && tool !== "run_command",
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
      };
    }
  }

  // Even on execute, injection never adds network/git/external/secret effects.
  return {
    ...grant,
    allowedEffects: grant.allowedEffects.filter(
      (effect) =>
        effect !== "git_write" &&
        effect !== "external_write" &&
        effect !== "network_access" &&
        effect !== "secret_use",
    ),
    networkHosts: [],
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
  mode: DecisionPolicyInput["envelope"]["mode"];
  reasonCodes: readonly DecisionReasonCode[];
}): string {
  const { route, planningDepth, mode, reasonCodes } = params;
  return `mode=${mode}; route=${route}; planningDepth=${planningDepth}; reasons=${reasonCodes.join(",")}`;
}
