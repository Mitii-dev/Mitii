/**
 * S3A-QUALITY — runtime anti-junk bar on PlanArtifact (paths, verify, concreteness).
 * Planning module still owns ValidatePlan; this is a thin post-plan gate.
 */

import {
  changeLikePhaseName,
  isConcretePlanTargetRef,
  isConcretePlanVerification,
} from "../../../modules/planning";
import { rejectHollowPlan } from "./RejectHollowPlan";

export interface EnforcePlanQualityInput {
  objective?: string;
  phases?: Array<{
    name?: string;
    steps?: Array<{
      targetRefs?: string[];
      actionSummary?: string;
      intent?: string;
    }>;
  }>;
  verification?: {
    checks?: string[];
    commands?: string[];
    manualQa?: string[];
  };
  nonGoals?: string[];
  /** Visible plans require stronger bars. */
  planningDepth?: string;
  requireConcreteTargets?: boolean;
  requireVerification?: boolean;
}

export interface EnforcePlanQualityResult {
  ok: boolean;
  reasonCodes: string[];
}

const VAGUE_ACTION =
  /\b(?:do\s+the\s+thing|fix\s+it|make\s+it\s+work|handle\s+appropriately|update\s+as\s+needed)\b/i;

/**
 * Hollow + concrete targetRefs on change phases + verification substance.
 */
export function enforcePlanQuality(
  input: EnforcePlanQualityInput,
): EnforcePlanQualityResult {
  const reasonCodes: string[] = [];
  const hollow = rejectHollowPlan({
    title: input.objective,
    phases: input.phases?.map((phase) => ({
      name: phase.name,
      steps: phase.steps,
    })),
  });
  if (!hollow.ok) {
    return {
      ok: false,
      reasonCodes: [hollow.reasonCode, "plan_quality_hollow"],
    };
  }
  reasonCodes.push("plan_quality_hollow_passed");

  const requireTargets =
    input.requireConcreteTargets === true ||
    input.planningDepth === "visible";
  const requireVerify =
    input.requireVerification === true ||
    input.planningDepth === "visible";

  if (requireTargets) {
    const changePhases = (input.phases ?? []).filter((phase) =>
      changeLikePhaseName(phase.name ?? ""),
    );
    const steps = (
      changePhases.length > 0 ? changePhases : input.phases ?? []
    ).flatMap((phase) => phase.steps ?? []);

    let concreteSteps = 0;
    let vagueActions = 0;
    for (const step of steps) {
      const refs = step.targetRefs ?? [];
      if (refs.some((ref) => isConcretePlanTargetRef(ref))) {
        concreteSteps += 1;
      }
      const summary = `${step.actionSummary ?? ""} ${step.intent ?? ""}`;
      if (VAGUE_ACTION.test(summary) || summary.trim().length < 8) {
        vagueActions += 1;
      }
    }
    if (steps.length > 0 && concreteSteps === 0) {
      return {
        ok: false,
        reasonCodes: [
          ...reasonCodes,
          "plan_quality_no_concrete_targets",
        ],
      };
    }
    if (steps.length > 0 && vagueActions === steps.length) {
      return {
        ok: false,
        reasonCodes: [...reasonCodes, "plan_quality_vague_actions"],
      };
    }
    reasonCodes.push("plan_quality_targets_ok");
  }

  if (requireVerify) {
    const checks = [
      ...(input.verification?.checks ?? []),
      ...(input.verification?.commands ?? []),
      ...(input.verification?.manualQa ?? []),
    ];
    const evidenceKind =
      /^(?:diagnostics|tests?|typecheck|lint|build|diff_review|behavior)$/i;
    const concrete = checks.filter(
      (c) =>
        evidenceKind.test(c.trim()) || isConcretePlanVerification(c),
    );
    if (checks.length === 0 || concrete.length === 0) {
      return {
        ok: false,
        reasonCodes: [
          ...reasonCodes,
          "plan_quality_weak_verification",
        ],
      };
    }
    reasonCodes.push("plan_quality_verify_ok");
  }

  // Soft note only — empty non-goals is fine; placeholder non-goals are junk.
  const nonGoals = input.nonGoals ?? [];
  if (
    nonGoals.length > 0 &&
    nonGoals.every((g) => /^(?:n\/a|none|tbd|todo)$/i.test(g.trim()))
  ) {
    return {
      ok: false,
      reasonCodes: [...reasonCodes, "plan_quality_placeholder_non_goals"],
    };
  }

  reasonCodes.push("plan_quality_passed");
  return { ok: true, reasonCodes };
}
