import type {
  DiscoveryBrief,
  PlanPhase,
  PlanStep,
  PlanningBuildEvidence,
  PlanningTaskEvidence,
} from "../contracts";
import { PLANNING_WORKING_SET_POLICY } from "../policy";
import { isArchitectureScaleAsk } from "./draftArchitectureSteps";
import {
  buildDiagnosticChangeSteps,
  mergeDiagnosticChangeSteps,
} from "./draftDiagnosticSteps";
import { buildDiscoveryChangeSteps } from "./draftDiscoverySurfaces";
import { normalizePhaseName } from "./draftPlanShared";

/**
 * Preflight diagnostics must survive skill-driven phase templates. Prefer a
 * Change-like phase; otherwise insert a dedicated Change phase.
 */
export function injectDiscoveryStepsIntoChangePhase(
  phases: PlanPhase[],
  discoveryBrief: DiscoveryBrief | undefined,
  risk: PlanStep["riskLevel"],
): PlanPhase[] {
  const discoverySteps = buildDiscoveryChangeSteps(discoveryBrief, risk);
  if (discoverySteps.length === 0) {
    return phases;
  }
  const changeIdx = phases.findIndex((phase) => isChangeLikePhase(phase.name));
  if (changeIdx < 0) {
    return phases;
  }
  return phases.map((phase, index) => {
    if (index !== changeIdx) {
      return phase;
    }
    const retained = phase.steps.filter(
      (item) => !item.id.startsWith("step-change-surface-"),
    );
    return {
      ...phase,
      steps: [...discoverySteps, ...retained].slice(
        0,
        PLANNING_WORKING_SET_POLICY.maxBatchesOnPlan,
      ),
    };
  });
}

export function injectDiagnosticStepsIntoChangePhase(
  phases: PlanPhase[],
  buildEvidence: PlanningBuildEvidence | undefined,
  risk: PlanStep["riskLevel"],
  maxFilesPerBatch?: number,
  evidence?: PlanningTaskEvidence,
  objective?: string,
): PlanPhase[] {
  const diagnosticSteps = buildDiagnosticChangeSteps(
    buildEvidence,
    risk,
    maxFilesPerBatch,
  );
  if (diagnosticSteps.length === 0) {
    return phases;
  }

  const preferArchitectureFirst =
    evidence !== undefined &&
    objective !== undefined &&
    isArchitectureScaleAsk(evidence, objective);

  const changeIdx = phases.findIndex((phase) => isChangeLikePhase(phase.name));
  if (changeIdx >= 0) {
    return phases.map((phase, index) => {
      if (index !== changeIdx) {
        return phase;
      }
      const retained = phase.steps.filter(
        (item) => !item.id.startsWith("step-fix-diagnostic-"),
      );
      return {
        ...phase,
        steps: mergeDiagnosticChangeSteps(
          diagnosticSteps,
          retained,
          preferArchitectureFirst,
        ),
      };
    });
  }

  const verifyIdx = phases.findIndex(
    (phase) => normalizePhaseName(phase.name) === "verify",
  );
  const insertAt = verifyIdx >= 0 ? verifyIdx : phases.length;
  const previousId =
    insertAt > 0 ? phases[insertAt - 1]?.id : undefined;
  const changePhase: PlanPhase = {
    id: "phase-change",
    name: "Change",
    purpose:
      "Apply concrete diagnostic fixes from preflight build evidence.",
    dependencies: previousId ? [previousId] : [],
    successCriteria: [
      "Reported diagnostics are resolved without unrelated edits.",
    ],
    steps: mergeDiagnosticChangeSteps(diagnosticSteps, [], preferArchitectureFirst),
  };

  const next = [...phases];
  next.splice(insertAt, 0, changePhase);
  if (verifyIdx >= 0) {
    const shiftedVerifyIdx = insertAt + 1;
    next[shiftedVerifyIdx] = {
      ...next[shiftedVerifyIdx]!,
      dependencies: [changePhase.id],
    };
  }
  return next.slice(0, 6);
}

function isChangeLikePhase(name: string): boolean {
  const normalized = normalizePhaseName(name);
  return (
    normalized === "change" ||
    /^(change|implement|fix|build|apply)/.test(normalized)
  );
}
