import {
  planArtifactSchema,
  type PlanArtifact,
  type PlanStrategyDecision,
  type PlanningParsedInput,
  type PlanningReasonCode,
} from "../contracts";
import {
  DEFAULT_MAX_OPEN_QUESTIONS,
  DEFAULT_MAX_PLAN_PHASES,
  DEFAULT_MAX_STEPS_PER_PHASE,
} from "../defaults";
import { PLANNING_WORKING_SET_POLICY } from "../policy";

export interface ValidatePlanResult {
  plan: PlanArtifact;
  warnings: string[];
  reasonCodes: PlanningReasonCode[];
  ok: boolean;
}

/**
 * Validate and lightly normalize a plan against depth/profile expectations.
 */
export function validatePlan(params: {
  plan: PlanArtifact;
  input: PlanningParsedInput;
  strategy?: PlanStrategyDecision;
}): ValidatePlanResult {
  const { input } = params;
  const warnings: string[] = [];
  const reasonCodes: PlanningReasonCode[] = ["plan_sections_required"];

  const parsed = planArtifactSchema.safeParse(params.plan);
  if (!parsed.success) {
    return {
      plan: params.plan,
      warnings: ["Plan failed schema validation."],
      reasonCodes: ["plan_blocked_invalid"],
      ok: false,
    };
  }

  let plan = parsed.data;

  // Discovery already ran (files were read / a DiscoveryBrief exists) — a
  // Discover/Inspect/Explore phase here would mean rediscovering.
  if (input.discoveryBrief && plan.phases.some(isDiscoverNamedPhase)) {
    const discoverIds = new Set(
      plan.phases.filter(isDiscoverNamedPhase).map((phase) => phase.id),
    );
    plan = {
      ...plan,
      phases: plan.phases
        .filter((phase) => !discoverIds.has(phase.id))
        .map((phase) => ({
          ...phase,
          dependencies: phase.dependencies.filter(
            (dependencyId) => !discoverIds.has(dependencyId),
          ),
        })),
    };
    warnings.push(
      "Removed a Discover phase from a plan drafted after discovery already ran.",
    );
  }

  if (input.planningDepth === "visible" && plan.openQuestions.length > 0) {
    reasonCodes.push("plan_open_questions");
  }

  if ((input.processHints?.length ?? 0) > 0) {
    reasonCodes.push("plan_process_hints_applied");
  }
  if ((input.skills?.length ?? 0) > 0) {
    reasonCodes.push("plan_skills_considered");
  }
  if (
    (input.buildEvidence?.diagnostics?.length ?? 0) > 0 &&
    params.strategy?.useBuildEvidence !== false
  ) {
    reasonCodes.push("plan_diagnostics_considered");
  }
  if (input.discoveryBrief) {
    const insufficient =
      input.discoveryBrief.confidence === "low" ||
      input.discoveryBrief.proposedChangeSurfaces.length === 0;
    reasonCodes.push(
      insufficient ? "plan_discovery_insufficient" : "plan_discovery_applied",
    );
  }

  if (
    (plan.dimensions.risk === "high" || plan.dimensions.risk === "critical") &&
    !plan.rollback
  ) {
    warnings.push("High-risk plan is missing rollback notes; adding a default.");
    plan = {
      ...plan,
      rollback:
        "Revert the change set, restore prior data/config if touched, and re-verify.",
    };
  }

  if (
    (plan.dimensions.risk === "high" || plan.dimensions.risk === "critical") &&
    !plan.approvalRequired
  ) {
    plan = { ...plan, approvalRequired: true };
  }

  if (plan.openQuestions.length > DEFAULT_MAX_OPEN_QUESTIONS) {
    plan = {
      ...plan,
      openQuestions: plan.openQuestions.slice(0, DEFAULT_MAX_OPEN_QUESTIONS),
    };
    warnings.push("Open questions were truncated to the visible-plan limit.");
  }

  if (plan.phases.length > DEFAULT_MAX_PLAN_PHASES) {
    plan = {
      ...plan,
      phases: plan.phases.slice(0, DEFAULT_MAX_PLAN_PHASES),
    };
    warnings.push("Phases were truncated to the plan limit.");
  }

  plan = {
    ...plan,
    phases: plan.phases.map((phase) => {
      const maxSteps = maxStepsForPhase(phase.name);
      return phase.steps.length > maxSteps
        ? {
            ...phase,
            steps: phase.steps.slice(0, maxSteps),
          }
        : phase;
    }),
  };

  reasonCodes.push("plan_validated");
  return {
    plan,
    warnings,
    reasonCodes: unique(reasonCodes),
    ok: true,
  };
}

function unique(codes: readonly PlanningReasonCode[]): PlanningReasonCode[] {
  return [...new Set(codes)];
}

function maxStepsForPhase(name: string): number {
  if (/change|implement|fix|build|apply/i.test(name)) {
    return PLANNING_WORKING_SET_POLICY.maxBatchesOnPlan;
  }
  return DEFAULT_MAX_STEPS_PER_PHASE;
}

function isDiscoverNamedPhase(phase: { name: string }): boolean {
  return /discover|inspect|explore/i.test(phase.name);
}
