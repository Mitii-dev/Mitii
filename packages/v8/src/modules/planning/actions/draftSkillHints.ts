import type {
  DiscoveryBrief,
  PlanChangeImpact,
  PlanPhase,
  PlanStep,
  PlanningBuildEvidence,
  PlanningSkillHint,
  PlanningTaskEvidence,
} from "../contracts";
import { PLANNING_PROCESS_META_STEP } from "../policy";
import { buildChangeSteps, summarizeImplementAction } from "./draftChangeSteps";
import {
  acceptanceCriteria,
  buildVerification,
  doneOutcome,
} from "./draftPlanEvidence";
import {
  scopeLabel,
  shouldIncludeVerifyPhase,
  specializeIntent,
  toTitleCase,
} from "./draftPlanPhrases";
import {
  clipPhrase,
  normalizePhaseName,
  slugify,
  step,
  uniqueStrings,
} from "./draftPlanShared";
import { buildVerifySteps } from "./draftVerifySteps";

export interface SkillPhaseHint {
  name: string;
  steps: string[];
}

export function extractSkillPhaseHints(
  skills: readonly PlanningSkillHint[],
): SkillPhaseHint[] {
  const hints: SkillPhaseHint[] = [];
  for (const skill of skills) {
    const planningText = extractPlanningText(skill.content);
    if (!planningText) {
      continue;
    }
    hints.push(...parsePhaseHints(planningText));
  }
  return mergePhaseHints(hints).slice(0, 6);
}

function extractPlanningText(content: string): string | undefined {
  const marker = content.match(/^Planning:\s*$/im);
  const heading = content.match(
    /^#{1,3}\s+(agent\s+discovery|planning|plan\s+template)\s*$/im,
  );
  const start = marker ?? heading;
  if (start?.index === undefined) {
    return undefined;
  }
  const after = content.slice(start.index + start[0].length);
  /**
   * Skills often follow the compact template with a Playbook / When-to-use
   * essay. Ingesting that prose turns process advice into 30+ fake plan steps.
   */
  const stop = after.search(
    /\n#{1,3}\s+(?:playbook|when\s+to\s+use|when\s+not|overview|step\s+\d)\b/i,
  );
  const bounded = (stop >= 0 ? after.slice(0, stop) : after).trim();
  return bounded.length > 0 ? bounded.slice(0, 2_000) : undefined;
}

function parsePhaseHints(text: string): SkillPhaseHint[] {
  const phases: SkillPhaseHint[] = [];
  let current: SkillPhaseHint | undefined;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) {
      current = undefined;
      continue;
    }
    const phaseMatch = /^([A-Za-z][A-Za-z0-9 /_-]{1,80}):$/.exec(line);
    if (phaseMatch) {
      current = { name: phaseMatch[1]!.trim(), steps: [] };
      phases.push(current);
      continue;
    }
    const stepMatch = /^[-*]\s+(.+)$/.exec(line);
    if (stepMatch && current && current.steps.length < 8) {
      current.steps.push(stepMatch[1]!.trim());
    }
  }

  return phases.filter((phase) => phase.steps.length > 0);
}

function mergePhaseHints(
  hints: readonly SkillPhaseHint[],
): SkillPhaseHint[] {
  const byName = new Map<string, SkillPhaseHint>();
  for (const hint of hints) {
    const key = normalizePhaseName(hint.name);
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, { name: hint.name, steps: uniqueStrings(hint.steps) });
      continue;
    }
    existing.steps = uniqueStrings([...existing.steps, ...hint.steps]);
  }
  return [...byName.values()];
}

/**
 * Drop task-breakdown / playbook methodology bullets.
 * If nothing executable remains, callers fall back to dimension-driven phases.
 */
export function filterExecutableSkillPhaseHints(
  hints: readonly SkillPhaseHint[],
  skipDiscover = false,
): SkillPhaseHint[] {
  return hints
    .filter(
      (hint) =>
        !skipDiscover || normalizePhaseName(hint.name) !== "discover",
    )
    .map((hint) => ({
      name: hint.name,
      steps: hint.steps.filter((step) => !PLANNING_PROCESS_META_STEP.test(step)),
    }))
    .filter((hint) => hint.steps.length > 0);
}

export function buildSkillHintPhases(params: {
  skillPhaseHints: readonly SkillPhaseHint[];
  evidence: PlanningTaskEvidence;
  objective: string;
  targetRefs: readonly string[];
  changeImpact: readonly PlanChangeImpact[];
  processHints: readonly string[];
  buildEvidence?: PlanningBuildEvidence;
  discoveryBrief?: DiscoveryBrief;
  maxFilesPerBatch?: number;
}): PlanPhase[] {
  const phases: PlanPhase[] = [];
  const shortObjective = clipPhrase(params.objective, 80);
  for (const hint of params.skillPhaseHints) {
    phases.push({
      id: `phase-${slugify(hint.name)}`,
      name: toTitleCase(hint.name),
      purpose: phasePurpose(hint.name, shortObjective),
      dependencies:
        phases.length > 0 ? [phases[phases.length - 1]!.id] : [],
      successCriteria: acceptanceCriteria(
        params.evidence,
        params.objective,
        phaseSuccessCriteria(hint.name),
      ),
      steps: hint.steps.slice(0, 8).map((summary, index) =>
        step(
          `step-${slugify(hint.name)}-${index + 1}`,
          specializeIntent(summary, params.targetRefs),
          params.targetRefs,
          actionSummaryForSkillStep({
            phaseName: hint.name,
            stepSummary: summary,
            objective: params.objective,
            targetRefs: params.targetRefs,
            changeImpact: params.changeImpact,
            processHints: params.processHints,
          }),
          expectedOutcomeForSkillStep(
            hint.name,
            summary,
            params.objective,
            params.evidence,
          ),
          riskForPhase(hint.name, params.evidence.risk),
          verificationForPhase(hint.name, params.evidence),
        ),
      ),
    });
  }

  if (!hasPhase(phases, "change")) {
    phases.push({
      id: "phase-change",
      name: "Change",
      purpose: `Apply the smallest coherent change set for "${shortObjective}".`,
      dependencies:
        phases.length > 0 ? [phases[phases.length - 1]!.id] : [],
      successCriteria: acceptanceCriteria(params.evidence, params.objective, [
        "Changes match the objective and constraints.",
        "No unrelated surfaces are modified.",
      ]),
      steps: buildChangeSteps(
        params.evidence,
        params.objective,
        params.targetRefs,
        params.changeImpact,
        params.processHints,
        params.buildEvidence,
        params.discoveryBrief,
        params.maxFilesPerBatch,
      ),
    });
  }

  if (
    shouldIncludeVerifyPhase(params.evidence) &&
    !hasPhase(phases, "verify")
  ) {
    const verification = buildVerification(
      params.evidence,
      params.discoveryBrief,
    );
    phases.push({
      id: "phase-verify",
      name: "Verify",
      purpose: `Prove "${shortObjective}" with automated and manual checks.`,
      dependencies:
        phases.length > 0 ? [phases[phases.length - 1]!.id] : [],
      successCriteria: acceptanceCriteria(params.evidence, params.objective, [
        "Applicable checks pass or failures are explained.",
        "Rollback notes remain valid.",
      ]),
      steps: buildVerifySteps(
        params.evidence,
        params.objective,
        params.targetRefs,
        verification,
      ),
    });
  }

  return phases.slice(0, 6);
}

function hasPhase(phases: readonly PlanPhase[], name: string): boolean {
  const normalized = normalizePhaseName(name);
  return phases.some((phase) => normalizePhaseName(phase.name) === normalized);
}

function phasePurpose(name: string, shortObjective: string): string {
  const normalized = normalizePhaseName(name);
  if (normalized === "discover") {
    return `Inspect current behavior for "${shortObjective}" before changing anything.`;
  }
  if (normalized === "change") {
    return `Apply the smallest coherent change set for "${shortObjective}".`;
  }
  if (normalized === "verify") {
    return `Prove "${shortObjective}" with automated and manual checks.`;
  }
  return `Complete the ${toTitleCase(name)} phase for "${shortObjective}".`;
}

function phaseSuccessCriteria(name: string): string[] {
  const normalized = normalizePhaseName(name);
  if (normalized === "discover") {
    return [
      "Relevant targets and constraints are identified.",
      "Enough evidence exists to change safely.",
    ];
  }
  if (normalized === "change") {
    return [
      "Changes match the objective and constraints.",
      "No unrelated surfaces are modified.",
    ];
  }
  if (normalized === "verify") {
    return [
      "Applicable checks pass or failures are explained.",
      "Completion evidence is available.",
    ];
  }
  return ["The phase outcome is complete and bounded to the objective."];
}

function actionSummaryForSkillStep(params: {
  phaseName: string;
  stepSummary: string;
  objective: string;
  targetRefs: readonly string[];
  changeImpact: readonly PlanChangeImpact[];
  processHints: readonly string[];
}): string {
  const normalized = normalizePhaseName(params.phaseName);
  if (normalized === "change") {
    return summarizeImplementAction(
      params.objective,
      params.targetRefs,
      params.changeImpact,
      params.processHints,
    );
  }
  const scope = scopeLabel(params.targetRefs);
  if (scope && !params.stepSummary.includes(params.targetRefs[0] ?? "")) {
    return `${params.stepSummary}${scope}.`;
  }
  return params.stepSummary;
}

function expectedOutcomeForSkillStep(
  phaseName: string,
  stepSummary: string,
  objective: string,
  evidence: PlanningTaskEvidence,
): string {
  const normalized = normalizePhaseName(phaseName);
  const shortObjective = clipPhrase(objective, 80);
  if (normalized === "discover") {
    return `Current behavior and evidence for "${shortObjective}" are known.`;
  }
  if (normalized === "change") {
    return doneOutcome(evidence, shortObjective);
  }
  if (normalized === "verify") {
    return `Verification evidence supports completing "${shortObjective}".`;
  }
  return `${stepSummary} is complete.`;
}

function riskForPhase(
  phaseName: string,
  taskRisk: PlanStep["riskLevel"],
): PlanStep["riskLevel"] {
  const normalized = normalizePhaseName(phaseName);
  if (normalized === "discover") {
    return "low";
  }
  if (normalized === "verify") {
    return taskRisk === "low" ? "low" : "medium";
  }
  return taskRisk;
}

function verificationForPhase(
  phaseName: string,
  evidence: PlanningTaskEvidence,
): string | undefined {
  if (normalizePhaseName(phaseName) !== "verify") {
    return undefined;
  }
  const verification = buildVerification(evidence);
  const parts = [
    ...verification.checks,
    ...verification.manualQa,
  ];
  return parts.length > 0
    ? parts.join(", ")
    : "applicable automated and manual checks";
}
