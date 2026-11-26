import type { PlanningResult } from "../../../modules/planning";
import {
  enforcePlanQuality,
  type EnforcePlanQualityResult,
} from "./EnforcePlanQuality";
import { rejectHollowPlan } from "./RejectHollowPlan";

export interface AssemblePlanQualityGatesInput {
  artifact: PlanningResult["plan"] | undefined;
  planningStatus: PlanningResult["status"];
  planningDepth: string;
  mode: string | undefined;
  discoveryQualityOk: boolean | undefined;
  discoveryRan: boolean;
}

export interface AssemblePlanQualityGatesResult {
  hollowCheck: ReturnType<typeof rejectHollowPlan>;
  quality: ReturnType<typeof enforcePlanQuality>;
  effectiveHollow: boolean;
  discoveryQualityFailed: boolean;
}

/**
 * Hollow + S3A-QUALITY bars; fail-close quality only on agent+visible execute.
 */
export function assemblePlanQualityGates(
  input: AssemblePlanQualityGatesInput,
): AssemblePlanQualityGatesResult {
  const artifact = input.artifact;
  const hollowCheck = artifact
    ? rejectHollowPlan({
        title: artifact.objective,
        phases: artifact.phases?.map((phase) => ({
          name: phase.name,
          steps: phase.steps,
        })),
      })
    : input.planningStatus === "drafted" ||
        input.planningStatus === "validated" ||
        input.planningStatus === "compacted"
      ? ({ ok: false, reasonCode: "plan_hollow_no_artifact" } as const)
      : ({ ok: true } as const);

  const quality: EnforcePlanQualityResult = artifact
    ? enforcePlanQuality({
        objective: artifact.objective,
        phases: artifact.phases?.map((phase) => ({
          name: phase.name,
          steps: phase.steps?.map((step) => ({
            targetRefs: step.targetRefs,
            actionSummary: step.actionSummary,
            intent: step.intent,
          })),
        })),
        verification: artifact.verification
          ? {
              checks: artifact.verification.checks,
              commands: artifact.verification.commands,
              manualQa: artifact.verification.manualQa,
            }
          : undefined,
        nonGoals: (artifact as { nonGoals?: string[] }).nonGoals,
        planningDepth: input.planningDepth,
        requireConcreteTargets: input.planningDepth === "visible",
        requireVerification: input.planningDepth === "visible",
      })
    : { ok: true, reasonCodes: ["plan_quality_skipped_no_artifact"] };

  const discoveryQualityFailed =
    input.discoveryRan && input.discoveryQualityOk === false;

  const qualityFailCloses =
    !quality.ok &&
    input.mode === "agent" &&
    input.planningDepth === "visible";

  const effectiveHollow =
    !hollowCheck.ok || discoveryQualityFailed || qualityFailCloses;

  return {
    hollowCheck,
    quality,
    effectiveHollow,
    discoveryQualityFailed,
  };
}
