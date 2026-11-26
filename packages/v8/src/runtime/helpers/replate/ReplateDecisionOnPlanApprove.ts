/**
 * Approve-plan replate (S10-REPLATE).
 * Never mutates the frozen prior decision — mints a new execute decision
 * with agent_execute grant and writePaths ⊆ plan targets.
 */

import {
  compileGrantFromPlate,
  selectDecisionPlate,
  type GrantProfile,
} from "../../../modules/decision-policy";
import { selectRouteBody } from "../routes";
import type { RuntimeDecisionSketch } from "../../flow/steps/5-Decide";
import {
  extractPlanWriteTargets,
  intersectScopesWithPlanTargets,
  type PlanWriteTargetSource,
} from "./ExtractPlanWriteTargets";

export interface ReplateDecisionOnPlanApproveInput {
  /** Frozen decision from the plan-approval checkpoint — not mutated. */
  priorDecision: RuntimeDecisionSketch;
  plan?: PlanWriteTargetSource;
  taskList?: PlanWriteTargetSource;
  mcpServerIds?: readonly string[];
}

export interface ReplateDecisionOnPlanApproveResult {
  decision: RuntimeDecisionSketch;
  /** Copy of prior for storeroom audit. */
  priorDecisionFrozen: RuntimeDecisionSketch;
  planWriteTargets: string[];
  reasonCodes: string[];
}

/**
 * Mint execute + agent_execute decision scoped to plan write targets.
 */
export function replateDecisionOnPlanApprove(
  input: ReplateDecisionOnPlanApproveInput,
): ReplateDecisionOnPlanApproveResult {
  const prior = structuredClone(input.priorDecision);
  const planWriteTargets = extractPlanWriteTargets(
    input.plan ?? input.taskList,
  );

  const plate = selectDecisionPlate({
    mode: "agent",
    primaryTaskIntent: "feature",
    clarityConfidence: "high",
    planningHint: "none",
    askUser: false,
    risk: "low",
    difficulty: "simple",
    turnKind: "continue",
  });

  // Prefer an execute plate when registry returns one; else force wire shape.
  const wireRoute = plate.route === "answer" ? "execute" : plate.route;
  const executeRoute = wireRoute === "clarify" ? "execute" : wireRoute;
  const grantProfile =
    executeRoute === "execute"
      ? ("agent_execute" as GrantProfile)
      : (plate.grantProfile as GrantProfile);

  const priorFence = prior.mutationPathScopes ?? [];
  const mutationPathScopes =
    planWriteTargets.length > 0
      ? intersectScopesWithPlanTargets(priorFence, planWriteTargets)
      : priorFence.length > 0
        ? [...priorFence]
        : undefined;

  const compiled = compileGrantFromPlate({
    grantProfile,
    pathScopes: prior.pathScopes.length > 0 ? prior.pathScopes : ["."],
    mutationPathScopes,
    mcpServerIds: input.mcpServerIds,
  });

  const routeBody = selectRouteBody({
    route: executeRoute === "execute" ? "execute" : executeRoute,
    planningDepth: "none",
    planGate: "none",
  });

  const decision: RuntimeDecisionSketch = {
    plateId: plate.id,
    route: executeRoute === "plan" ? "execute" : executeRoute,
    grantProfile,
    planningDepth: "none",
    planGate: "none",
    runDisposition: "continue",
    routeBody,
    pathScopes: prior.pathScopes.length > 0 ? [...prior.pathScopes] : ["."],
    ...(mutationPathScopes && mutationPathScopes.length > 0
      ? { mutationPathScopes }
      : {}),
    scopeEvidence: prior.scopeEvidence ?? "plan_targets",
    toolGrant: compiled.toolGrant,
    verification: {
      required: true,
      minimumEvidence: ["diagnostics", "diff_review"],
      checks: ["diagnostics", "diff_review"],
      allowUnavailable: true,
      onFailure: "retry",
    },
    repositoryContextRequired: true,
    rationale: `replate_from=${prior.plateId}; route=execute; grant=${grantProfile}`,
    reasonCodes: [
      ...plate.reasonCodes,
      ...compiled.reasonCodes,
      ...routeBody.reasonCodes,
      "replate_on_plan_approve",
      ...(planWriteTargets.length > 0
        ? ["replate_scopes_subseteq_plan"]
        : ["replate_scopes_no_plan_targets"]),
      "verification_required",
    ],
  };

  return {
    decision,
    priorDecisionFrozen: prior,
    planWriteTargets,
    reasonCodes: decision.reasonCodes,
  };
}
