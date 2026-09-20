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
import {
  changeLikePhaseName,
  isConcretePlanTargetRef,
  isConcretePlanVerification,
} from "../internal/concretePlanTargets";
import { PLANNING_WORKING_SET_POLICY } from "../policy";

export interface ValidatePlanResult {
  plan: PlanArtifact;
  warnings: string[];
  reasonCodes: PlanningReasonCode[];
  ok: boolean;
}

/**
 * Validate and lightly normalize a plan against depth/profile expectations.
 * Plan / Agent-visible thorough plans require concrete Change targetRefs
 * (files/symbols) — Mitii step-shape formula.
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

  const concreteness = enforceChangeStepConcreteness({
    plan,
    input,
    strategy: params.strategy,
  });
  plan = concreteness.plan;
  warnings.push(...concreteness.warnings);
  reasonCodes.push(...concreteness.reasonCodes);
  if (!concreteness.ok) {
    return {
      plan,
      warnings,
      reasonCodes: unique([...reasonCodes, "plan_blocked_invalid"]),
      ok: false,
    };
  }

  reasonCodes.push("plan_validated");
  return {
    plan,
    warnings,
    reasonCodes: unique(reasonCodes),
    ok: true,
  };
}

function enforceChangeStepConcreteness(params: {
  plan: PlanArtifact;
  input: PlanningParsedInput;
  strategy?: PlanStrategyDecision;
}): {
  plan: PlanArtifact;
  warnings: string[];
  reasonCodes: PlanningReasonCode[];
  ok: boolean;
} {
  const warnings: string[] = [];
  const reasonCodes: PlanningReasonCode[] = [];
  if (!requiresConcreteChangeSteps(params.input, params.strategy)) {
    return { plan: params.plan, warnings, reasonCodes, ok: true };
  }

  const changePhases = params.plan.phases.filter((phase) =>
    changeLikePhaseName(phase.name),
  );
  if (changePhases.length === 0) {
    // Clarify / open-question only plans have no Change phase — allowed.
    return { plan: params.plan, warnings, reasonCodes, ok: true };
  }

  let missingTargets = 0;
  let vagueTargets = 0;
  let missingVerification = 0;
  const phases = params.plan.phases.map((phase) => {
    if (!changeLikePhaseName(phase.name)) {
      return phase;
    }
    return {
      ...phase,
      steps: phase.steps.map((step) => {
        const concreteRefs = step.targetRefs.filter(isConcretePlanTargetRef);
        if (step.targetRefs.length === 0) {
          missingTargets += 1;
        } else if (concreteRefs.length === 0) {
          vagueTargets += 1;
        }
        if (!isConcretePlanVerification(step.verification)) {
          missingVerification += 1;
        }
        return concreteRefs.length === step.targetRefs.length
          ? step
          : { ...step, targetRefs: concreteRefs };
      }),
    };
  });

  if (missingTargets > 0) {
    reasonCodes.push("plan_steps_missing_targets");
  }
  if (vagueTargets > 0) {
    reasonCodes.push("plan_steps_vague_targets");
  }
  if (missingVerification > 0) {
    reasonCodes.push("plan_steps_missing_verification");
    warnings.push(
      `${missingVerification} Change step(s) lack concrete verification checks.`,
    );
  }

  // Hollow Change steps (no concrete path/symbol) block thorough plans.
  const remainingConcrete = phases
    .filter((phase) => changeLikePhaseName(phase.name))
    .flatMap((phase) => phase.steps)
    .filter((step) => step.targetRefs.some(isConcretePlanTargetRef));

  if (remainingConcrete.length === 0) {
    warnings.push(
      "Thorough plan requires Change steps with concrete file or symbol targetRefs.",
    );
    return {
      plan: { ...params.plan, phases },
      warnings,
      reasonCodes,
      ok: false,
    };
  }

  if (missingTargets > 0 || vagueTargets > 0) {
    warnings.push(
      "Dropped or flagged Change steps without concrete file/symbol targets.",
    );
  }

  reasonCodes.push("plan_steps_concrete");
  return {
    plan: { ...params.plan, phases },
    warnings,
    reasonCodes,
    ok: true,
  };
}

function requiresConcreteChangeSteps(
  input: PlanningParsedInput,
  strategy?: PlanStrategyDecision,
): boolean {
  if (strategy?.strategy === "clarify") {
    return false;
  }
  // Thin / failed discovery keeps open-question plans — do not demand
  // concrete Change targetRefs that discovery could not supply.
  const brief = input.discoveryBrief;
  if (
    brief &&
    (brief.confidence === "low" || brief.proposedChangeSurfaces.length === 0)
  ) {
    return false;
  }
  if (input.mode === "plan") {
    return true;
  }
  return input.planningDepth === "visible";
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
