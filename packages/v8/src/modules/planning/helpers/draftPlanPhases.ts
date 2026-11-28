import type {
  DiscoveryBrief,
  PlanChangeImpact,
  PlanPhase,
  PlanningBuildEvidence,
  PlanningTaskEvidence,
} from "../contracts";
import { isArchitectureScaleAsk } from "./draftArchitectureSteps";
import { buildChangeSteps, buildDiscoverySteps } from "./draftChangeSteps";
import {
  injectDiagnosticStepsIntoChangePhase,
  injectDiscoveryStepsIntoChangePhase,
} from "./draftPhaseInjection";
import {
  acceptanceCriteria,
  buildVerification,
} from "./draftPlanEvidence";
import { shouldIncludeVerifyPhase } from "./draftPlanPhrases";
import { clipPhrase, step } from "./draftPlanShared";
import {
  buildSkillHintPhases,
  filterExecutableSkillPhaseHints,
  type SkillPhaseHint,
} from "./draftSkillHints";
import { buildVerifySteps } from "./draftVerifySteps";

export function buildPhases(params: {
  evidence: PlanningTaskEvidence;
  objective: string;
  targetRefs: readonly string[];
  changeImpact: readonly PlanChangeImpact[];
  processHints: readonly string[];
  skillPhaseHints: readonly SkillPhaseHint[];
  buildEvidence?: PlanningBuildEvidence;
  skipDiscover?: boolean;
  discoveryBrief?: DiscoveryBrief;
  maxFilesPerBatch?: number;
  clarify?: boolean;
}): PlanPhase[] {
  const {
    evidence,
    objective,
    targetRefs,
    changeImpact,
    processHints,
    skillPhaseHints,
    buildEvidence,
    discoveryBrief,
  } = params;
  const shortObjective = clipPhrase(objective, 80);

  // Clarify strategy: open questions only — never seed-read Change skeletons.
  if (params.clarify) {
    return [
      {
        id: "phase-change",
        name: "Change",
        purpose: `Resolve open questions before changing files for "${shortObjective}".`,
        dependencies: [],
        successCriteria: acceptanceCriteria(evidence, objective, [
          "Open questions are answered or the user confirms the change surface.",
          "No file mutations are attempted until the plan is revised.",
        ]),
        steps: [
          step(
            "step-open-questions",
            "Resolve remaining open questions before changing files",
            [],
            "Discovery did not identify a concrete change surface. Answer the open questions instead of inventing file work.",
            "Open questions are resolved or the user confirms the change surface.",
            "low",
          ),
        ],
      },
    ];
  }

  const needsDiscovery =
    !params.skipDiscover &&
    (evidence.scope === "package" ||
      evidence.scope === "repository" ||
      evidence.scope === "workspace" ||
      evidence.scope === "multi_file" ||
      evidence.complexity === "complex" ||
      evidence.complexity === "very_complex" ||
      evidence.recommendsPlanning === true);

  const executableSkillHints = filterExecutableSkillPhaseHints(
    skillPhaseHints,
    params.skipDiscover === true,
  );
  // Architecture-scale package asks must keep objective-shaped Change steps.
  // Skill playbooks (security, git-commit, etc.) were replacing the checklist
  // with "Validate and sanitize" / "Subject ≤72 chars" while preflight TS
  // diagnostics stole step 1 (BillBuddy POM DeepSeek 70k run).
  if (
    executableSkillHints.length > 0 &&
    !isArchitectureScaleAsk(evidence, objective)
  ) {
    return injectDiscoveryStepsIntoChangePhase(
      injectDiagnosticStepsIntoChangePhase(
        buildSkillHintPhases({
          skillPhaseHints: executableSkillHints,
          evidence,
          objective,
          targetRefs,
          changeImpact,
          processHints,
          buildEvidence,
          discoveryBrief,
          maxFilesPerBatch: params.maxFilesPerBatch,
        }),
        buildEvidence,
        evidence.risk,
        params.maxFilesPerBatch,
        evidence,
        objective,
      ),
      discoveryBrief,
      evidence.risk,
    );
  }

  const phases: PlanPhase[] = [];
  const includeVerify = shouldIncludeVerifyPhase(evidence);

  if (needsDiscovery) {
    phases.push({
      id: "phase-discover",
      name: "Discover",
      purpose: `Inspect current behavior for "${shortObjective}" before changing anything.`,
      dependencies: [],
      successCriteria: acceptanceCriteria(evidence, objective, [
        "Relevant targets and constraints are identified.",
        "Blocking open questions are listed or resolved.",
      ]),
      steps: buildDiscoverySteps(evidence, objective, targetRefs),
    });
  }

  phases.push({
    id: "phase-change",
    name: "Change",
    purpose: `Apply the smallest coherent change set for "${shortObjective}".`,
    dependencies: needsDiscovery ? ["phase-discover"] : [],
    successCriteria: acceptanceCriteria(evidence, objective, [
      "Changes match the objective and constraints.",
      "No unrelated surfaces are modified.",
    ]),
    steps: buildChangeSteps(
      evidence,
      objective,
      targetRefs,
      changeImpact,
      processHints,
      buildEvidence,
      discoveryBrief,
      params.maxFilesPerBatch,
    ),
  });

  if (includeVerify) {
    const verification = buildVerification(evidence, discoveryBrief);
    phases.push({
      id: "phase-verify",
      name: "Verify",
      purpose: `Prove "${shortObjective}" with automated and manual checks.`,
      dependencies: ["phase-change"],
      successCriteria: acceptanceCriteria(evidence, objective, [
        "Applicable checks pass or failures are explained.",
        "Rollback notes remain valid.",
      ]),
      steps: buildVerifySteps(evidence, objective, targetRefs, verification),
    });
  }

  return phases;
}
