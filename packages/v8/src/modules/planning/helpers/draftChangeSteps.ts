import type {
  DiscoveryBrief,
  PlanChangeImpact,
  PlanStep,
  PlanningBuildEvidence,
  PlanningTaskEvidence,
} from "../contracts";
import {
  buildArchitectureChangeSteps,
  isArchitectureScaleAsk,
} from "./draftArchitectureSteps";
import { buildDiagnosticChangeSteps } from "./draftDiagnosticSteps";
import { buildDiscoveryChangeSteps } from "./draftDiscoverySurfaces";
import { doneOutcome } from "./draftPlanEvidence";
import {
  actionAwareIntent,
  intentActionVerb,
  isRepairIntent,
  scopeLabel,
} from "./draftPlanPhrases";
import { clipPhrase, step } from "./draftPlanShared";

export function buildDiscoverySteps(
  evidence: PlanningTaskEvidence,
  objective: string,
  targetRefs: readonly string[],
): PlanStep[] {
  const scope = scopeLabel(targetRefs);
  const shortObjective = clipPhrase(objective, 80);
  const targetList =
    targetRefs.length > 0
      ? targetRefs.slice(0, 4).join(", ")
      : "the relevant modules, configs, and tests";

  if (isRepairIntent(evidence)) {
    return [
      step(
        "step-locate",
        clipPhrase(`Inspect failure evidence${scope}`, 200),
        targetRefs,
        `Collect current failure signals for ${targetList} related to "${shortObjective}".`,
        `A concrete failure inventory for "${shortObjective}" is known.`,
        "low",
      ),
      step(
        "step-evidence",
        clipPhrase(`Bound failing surfaces and constraints${scope}`, 200),
        targetRefs,
        `Identify the smallest change surface for "${shortObjective}" without unrelated edits.`,
        "Enough evidence exists to apply a bounded fix.",
        "low",
      ),
    ];
  }

  return [
    step(
      "step-locate",
      clipPhrase(`Inspect current behavior${scope}`, 200),
      targetRefs,
      `Search and read ${targetList} related to "${shortObjective}".`,
      `A bounded set of targets and constraints for "${shortObjective}" is known.`,
      "low",
    ),
    step(
      "step-evidence",
      clipPhrase(`Collect impact and verification evidence${scope}`, 200),
      targetRefs,
      `Review existing tests, APIs, configs, and failure modes that affect "${shortObjective}".`,
      "Enough evidence exists to choose a safe change sequence.",
      "low",
    ),
  ];
}

export function buildChangeSteps(
  evidence: PlanningTaskEvidence,
  objective: string,
  targetRefs: readonly string[],
  changeImpact: readonly PlanChangeImpact[],
  processHints: readonly string[],
  buildEvidence?: PlanningBuildEvidence,
  discoveryBrief?: DiscoveryBrief,
  maxFilesPerBatch?: number,
): PlanStep[] {
  const scope = scopeLabel(targetRefs);
  const shortObjective = clipPhrase(objective, 80);
  const verb = intentActionVerb(evidence.primaryIntent);
  const implementIntent = actionAwareIntent(verb, shortObjective, scope);
  const steps: PlanStep[] = [];

  const discoverySteps = buildDiscoveryChangeSteps(
    discoveryBrief,
    evidence.risk,
  );
  const diagnosticSteps = buildDiagnosticChangeSteps(
    buildEvidence,
    evidence.risk,
    maxFilesPerBatch,
  );
  const discoveryFailed =
    discoveryBrief !== undefined &&
    discoveryBrief.confidence === "low" &&
    discoverySteps.length === 0 &&
    diagnosticSteps.length === 0;

  // Low-confidence discovery must not invent architecture / implement steps.
  if (discoveryFailed) {
    return [
      step(
        "step-open-questions",
        "Resolve remaining open questions before changing files",
        [],
        "Discovery did not identify a concrete change surface. Answer the open questions instead of inventing file work.",
        "Open questions are resolved or the user confirms the change surface.",
        "low",
      ),
    ];
  }

  // Repair intents skip design-heavy approach selection.
  if (!isRepairIntent(evidence) && discoverySteps.length === 0) {
    steps.push(
      step(
        "step-design",
        clipPhrase(`Choose a non-hardcoded approach${scope}`, 200),
        targetRefs,
        `Select an approach for "${shortObjective}" that prefers existing seams over hardcoding.`,
        `An approach that preserves required behavior for "${shortObjective}" is selected.`,
        evidence.risk,
      ),
    );
  }

  steps.push(...discoverySteps);

  const architectureScale = isArchitectureScaleAsk(evidence, objective);
  const architectureSteps = architectureScale
    ? buildArchitectureChangeSteps(
        evidence,
        objective,
        targetRefs,
        processHints,
      )
    : [];

  // Prefer concrete diagnostic/discovery rows for repair asks — but never let
  // incidental preflight errors suppress architecture-scale objectives.
  if (architectureSteps.length > 0) {
    steps.push(...architectureSteps);
    steps.push(...diagnosticSteps);
  } else {
    steps.push(...diagnosticSteps);
    if (diagnosticSteps.length === 0 && discoverySteps.length === 0) {
      const fallbackArchitecture = buildArchitectureChangeSteps(
        evidence,
        objective,
        targetRefs,
        processHints,
      );
      if (fallbackArchitecture.length > 0) {
        steps.push(...fallbackArchitecture);
      } else {
        steps.push(
          step(
            "step-implement",
            implementIntent,
            targetRefs,
            summarizeImplementAction(
              objective,
              targetRefs,
              changeImpact,
              processHints,
            ),
            doneOutcome(evidence, shortObjective),
            evidence.risk,
          ),
        );
      }
    }
  }

  if (changeImpact.includes("security") || changeImpact.includes("data")) {
    steps.push(
      step(
        "step-safeguard",
        clipPhrase(`Apply safeguards for high-impact surfaces${scope}`, 200),
        targetRefs,
        "Account for auth, data integrity, and failure modes before finishing.",
        "High-impact failure modes have explicit handling.",
        evidence.risk === "low" ? "medium" : evidence.risk,
      ),
    );
  }

  return steps;
}

export function summarizeImplementAction(
  objective: string,
  targetRefs: readonly string[],
  changeImpact: readonly PlanChangeImpact[],
  processHints: readonly string[],
): string {
  const impact =
    changeImpact.length > 0 ? changeImpact.join(", ") : "code";
  const targets =
    targetRefs.length > 0
      ? ` Focus on ${targetRefs.slice(0, 4).join(", ")}.`
      : "";
  const hintNote =
    processHints.length > 0
      ? ` Consider process hints: ${processHints.join(", ")}.`
      : "";
  return `Apply "${clipPhrase(objective, 100)}" across impact surfaces (${impact}).${targets}${hintNote}`;
}
