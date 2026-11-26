/**
 * S3A-STEER — edit PlanArtifact without full rediscovery.
 * Rediscovery only when write targets are invalidated.
 */

import type { PlanArtifact, PlanPhase, PlanStep } from "../../../modules/planning";
import { rejectHollowPlan } from "./RejectHollowPlan";

export interface SteerPlanPatch {
  objective?: string;
  assumptions?: readonly string[];
  openQuestions?: readonly string[];
  constraints?: readonly string[];
  /** Replace targetRefs on a step by id. */
  stepTargetPatches?: readonly {
    stepId: string;
    targetRefs: readonly string[];
  }[];
  /** Replace actionSummary / intent on a step by id. */
  stepTextPatches?: readonly {
    stepId: string;
    intent?: string;
    actionSummary?: string;
    expectedOutcome?: string;
  }[];
}

export interface SteerPlanArtifactInput {
  plan: PlanArtifact;
  patch: SteerPlanPatch;
}

export interface SteerPlanArtifactResult {
  plan: PlanArtifact;
  needsRediscovery: boolean;
  hollowCheck: ReturnType<typeof rejectHollowPlan>;
  reasonCodes: string[];
}

function collectTargets(plan: PlanArtifact): Set<string> {
  const set = new Set<string>();
  for (const phase of plan.phases) {
    for (const step of phase.steps) {
      for (const ref of step.targetRefs ?? []) set.add(ref);
    }
  }
  return set;
}

function patchSteps(
  phases: PlanPhase[],
  patch: SteerPlanPatch,
): PlanPhase[] {
  const targetById = new Map(
    (patch.stepTargetPatches ?? []).map((p) => [p.stepId, p.targetRefs]),
  );
  const textById = new Map(
    (patch.stepTextPatches ?? []).map((p) => [p.stepId, p]),
  );
  if (targetById.size === 0 && textById.size === 0) return phases;

  return phases.map((phase) => ({
    ...phase,
    steps: phase.steps.map((step: PlanStep) => {
      const targets = targetById.get(step.id);
      const text = textById.get(step.id);
      if (!targets && !text) return step;
      return {
        ...step,
        ...(targets ? { targetRefs: [...targets] } : {}),
        ...(text?.intent ? { intent: text.intent } : {}),
        ...(text?.actionSummary ? { actionSummary: text.actionSummary } : {}),
        ...(text?.expectedOutcome
          ? { expectedOutcome: text.expectedOutcome }
          : {}),
      };
    }),
  }));
}

/**
 * Apply a steer patch. Marks needsRediscovery when prior targets are dropped
 * without replacement (scope invalidated).
 */
export function steerPlanArtifact(
  input: SteerPlanArtifactInput,
): SteerPlanArtifactResult {
  const before = collectTargets(input.plan);
  const reasonCodes = ["plan_steer_applied"];

  const next: PlanArtifact = {
    ...input.plan,
    ...(input.patch.objective
      ? { objective: input.patch.objective.trim() }
      : {}),
    ...(input.patch.assumptions
      ? { assumptions: [...input.patch.assumptions] }
      : {}),
    ...(input.patch.openQuestions
      ? { openQuestions: [...input.patch.openQuestions] }
      : {}),
    ...(input.patch.constraints
      ? { constraints: [...input.patch.constraints] }
      : {}),
    phases: patchSteps(input.plan.phases, input.patch),
  };

  const after = collectTargets(next);
  let needsRediscovery = false;
  if (before.size > 0) {
    const lost = [...before].filter((t) => !after.has(t));
    // Invalidate when ≥ half of prior targets vanish and replacements are empty/thin.
    if (lost.length >= Math.ceil(before.size / 2) && after.size < before.size) {
      needsRediscovery = true;
      reasonCodes.push("plan_steer_needs_rediscovery");
    }
  }
  if (
    (input.patch.stepTargetPatches?.length ?? 0) > 0 ||
    (input.patch.stepTextPatches?.length ?? 0) > 0
  ) {
    reasonCodes.push("plan_steer_steps_patched");
  }
  if (input.patch.objective) reasonCodes.push("plan_steer_objective");

  const hollowCheck = rejectHollowPlan({
    title: next.objective,
    phases: next.phases.map((phase) => ({
      name: phase.name,
      steps: phase.steps,
    })),
  });
  if (!hollowCheck.ok) {
    reasonCodes.push("plan_steer_hollow", hollowCheck.reasonCode);
  }

  return {
    plan: next,
    needsRediscovery,
    hollowCheck,
    reasonCodes,
  };
}
