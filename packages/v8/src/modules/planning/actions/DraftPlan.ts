import type {
  PlanArtifact,
  PlanChangeImpact,
  PlanPhase,
  PlanStep,
  PlanningSkillHint,
  PlanningParsedInput,
  PlanningTaskEvidence,
} from "../contracts";
import { PLANNING_SCHEMA_VERSION } from "../constants";
import { PLANNING_PROCESS_META_STEP } from "../policy";

/**
 * Draft a generic PlanArtifact from task dimensions and optional hints.
 * Not plan-type-driven — phases come from scope/risk/clarity/impact signals.
 */
export function draftPlan(input: PlanningParsedInput): PlanArtifact {
  if (input.priorPlan) {
    return {
      ...input.priorPlan,
      processHintsApplied: uniqueStrings([
        ...input.priorPlan.processHintsApplied,
        ...(input.processHints ?? []),
      ]),
    };
  }

  const { evidence } = input;
  const changeImpact = resolveChangeImpact(evidence);
  const approvalRequired =
    evidence.risk === "high" ||
    evidence.risk === "critical";
  const targetRefs = evidence.targets.map((t) => t.value).slice(0, 12);
  const objective = buildObjective(input.query, evidence);
  const openQuestions = buildOpenQuestions(evidence, input.processHints);
  const skillPhaseHints = extractSkillPhaseHints(input.skills ?? []);
  const phases = buildPhases({
    evidence,
    objective,
    targetRefs,
    changeImpact,
    processHints: input.processHints ?? [],
    skillPhaseHints,
  });

  return {
    schemaVersion: PLANNING_SCHEMA_VERSION,
    objective,
    assumptions: buildAssumptions(evidence),
    openQuestions,
    contextReviewed: input.contextReviewed ?? [],
    constraints: [...evidence.constraints],
    dimensions: {
      scope: evidence.scope,
      risk: evidence.risk,
      clarity: evidence.clarity,
      complexity: evidence.complexity,
      changeImpact,
    },
    phases,
    risks: buildRisks(evidence, changeImpact),
    alternatives: buildAlternatives(evidence),
    verification: buildVerification(evidence),
    rollback: buildRollback(evidence, changeImpact),
    approvalRequired,
    processHintsApplied: [...(input.processHints ?? [])],
  };
}

function buildObjective(
  query: string,
  evidence: PlanningTaskEvidence,
): string {
  const targetRefs = evidence.targets.map((t) => t.value);
  const candidates = [
    ...evidence.requestedOutcomes,
    query,
  ]
    .map((value) => sanitizeUserPhrase(value, targetRefs))
    .filter((value) => value.length >= 8 && !isPronounOnlyFollowUp(value));

  const preferred = pickPreferredPhrase(candidates);
  if (preferred) {
    return preferred.slice(0, 1_000);
  }

  const targetSummary = evidence.targets
    .filter((target) => target.explicit)
    .map((target) => target.value)
    .slice(0, 4)
    .join(", ");

  if (targetSummary) {
    return `Resolve ${evidence.primaryIntent} for ${targetSummary}`.slice(
      0,
      1_000,
    );
  }

  return `Complete ${evidence.primaryIntent} safely within the stated scope.`;
}

function isPronounOnlyFollowUp(text: string): boolean {
  return /^(?:please\s+|can\s+you\s+|could\s+you\s+)?(?:fix|update|change|check|do|handle|implement)\s+(?:it|this|that)\b/i.test(
    text,
  ) || text.length < 8;
}

function buildAssumptions(evidence: PlanningTaskEvidence): string[] {
  const assumptions: string[] = [];
  if (evidence.clarity === "clear" || evidence.clarity === "partially_clear") {
    assumptions.push(
      "Existing behavior outside the stated targets should remain unchanged unless the plan says otherwise.",
    );
  }
  if (evidence.targets.some((t) => t.explicit)) {
    assumptions.push("Explicit targets in the request are the primary change surface.");
  }
  if (evidence.recommendsVerification) {
    assumptions.push("Verification evidence is required before treating the work as done.");
  }
  return assumptions.slice(0, 8);
}

function buildOpenQuestions(
  evidence: PlanningTaskEvidence,
  processHints: readonly string[] | undefined,
): string[] {
  const questions: string[] = [];
  const scope = scopeLabel(evidence.targets.map((t) => t.value));
  if (evidence.clarity === "unclear" || evidence.clarity === "partially_clear") {
    questions.push(
      scope
        ? `For work${scope}: which outcome is in scope this turn, and what must stay unchanged?`
        : "Which outcome is in scope for this turn, and what should remain unchanged?",
    );
  }
  if (
    evidence.scope === "repository" ||
    evidence.scope === "workspace" ||
    evidence.scope === "unknown"
  ) {
    questions.push(
      "Which modules or packages are in scope if the change should not span the whole workspace?",
    );
  }
  if (evidence.constraints.length > 0) {
    questions.push(
      `If tradeoffs appear, which constraint wins first: ${evidence.constraints
        .slice(0, 2)
        .join("; ")}?`,
    );
  }
  const hints = processHints ?? [];
  if (hints.some((h) => /auth|sso|oidc|identity/i.test(h))) {
    questions.push(
      "Which identity provider and account-linking rules should be supported?",
    );
  }
  if (hints.some((h) => /migrat|data|schema/i.test(h))) {
    questions.push(
      "Is a reversible migration required, and what is the rollback window?",
    );
  }
  return uniqueStrings(questions).slice(0, 5);
}

function buildPhases(params: {
  evidence: PlanningTaskEvidence;
  objective: string;
  targetRefs: readonly string[];
  changeImpact: readonly PlanChangeImpact[];
  processHints: readonly string[];
  skillPhaseHints: readonly SkillPhaseHint[];
}): PlanPhase[] {
  const {
    evidence,
    objective,
    targetRefs,
    changeImpact,
    processHints,
    skillPhaseHints,
  } = params;
  const needsDiscovery =
    evidence.scope === "package" ||
    evidence.scope === "repository" ||
    evidence.scope === "workspace" ||
    evidence.scope === "multi_file" ||
    evidence.complexity === "complex" ||
    evidence.complexity === "very_complex" ||
    evidence.recommendsPlanning === true;

  const executableSkillHints = filterExecutableSkillPhaseHints(skillPhaseHints);
  if (executableSkillHints.length > 0) {
    return buildSkillHintPhases({
      skillPhaseHints: executableSkillHints,
      evidence,
      objective,
      targetRefs,
      changeImpact,
      processHints,
    });
  }

  const phases: PlanPhase[] = [];
  const shortObjective = clipPhrase(objective, 80);
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
    ),
  });

  if (includeVerify) {
    const verification = buildVerification(evidence);
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

interface SkillPhaseHint {
  name: string;
  steps: string[];
}

function extractSkillPhaseHints(
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
function filterExecutableSkillPhaseHints(
  hints: readonly SkillPhaseHint[],
): SkillPhaseHint[] {
  return hints
    .map((hint) => ({
      name: hint.name,
      steps: hint.steps.filter((step) => !PLANNING_PROCESS_META_STEP.test(step)),
    }))
    .filter((hint) => hint.steps.length > 0);
}

function buildSkillHintPhases(params: {
  skillPhaseHints: readonly SkillPhaseHint[];
  evidence: PlanningTaskEvidence;
  objective: string;
  targetRefs: readonly string[];
  changeImpact: readonly PlanChangeImpact[];
  processHints: readonly string[];
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
      ),
    });
  }

  if (
    shouldIncludeVerifyPhase(params.evidence) &&
    !hasPhase(phases, "verify")
  ) {
    const verification = buildVerification(params.evidence);
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

function normalizePhaseName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "skill-phase";
}

function toTitleCase(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
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

function buildDiscoverySteps(
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

function buildChangeSteps(
  evidence: PlanningTaskEvidence,
  objective: string,
  targetRefs: readonly string[],
  changeImpact: readonly PlanChangeImpact[],
  processHints: readonly string[],
): PlanStep[] {
  const scope = scopeLabel(targetRefs);
  const shortObjective = clipPhrase(objective, 80);
  const verb = intentActionVerb(evidence.primaryIntent);
  const implementIntent = actionAwareIntent(verb, shortObjective, scope);
  const steps: PlanStep[] = [];

  // Repair intents skip design-heavy approach selection.
  if (!isRepairIntent(evidence)) {
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

function buildVerifySteps(
  evidence: PlanningTaskEvidence,
  objective: string,
  targetRefs: readonly string[],
  verification: PlanArtifact["verification"],
): PlanStep[] {
  const scope = scopeLabel(targetRefs);
  const shortObjective = clipPhrase(objective, 80);
  const checks = [
    ...verification.checks,
    ...verification.manualQa,
  ];
  const checkText =
    checks.length > 0
      ? checks.join(", ")
      : "applicable automated and manual checks";
  const intent = isRepairIntent(evidence)
    ? `Verify the fix${scope}`
    : `Verify changes${scope}`;

  return [
    step(
      "step-verify",
      clipPhrase(intent, 200),
      targetRefs,
      `Run ${checkText} for the changed surfaces and confirm "${shortObjective}" still holds.`,
      doneOutcome(evidence, shortObjective),
      evidence.risk === "low" ? "low" : "medium",
      checkText,
    ),
  ];
}

function summarizeImplementAction(
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

function buildRisks(
  evidence: PlanningTaskEvidence,
  changeImpact: readonly PlanChangeImpact[],
): PlanArtifact["risks"] {
  const scope = scopeLabel(evidence.targets.map((t) => t.value));
  const risks: PlanArtifact["risks"] = [
    {
      id: "risk-scope-creep",
      summary: scope
        ? `Changes may expand beyond intended targets${scope}.`
        : "Changes may expand beyond the intended scope.",
      severity: evidence.risk === "low" ? "medium" : evidence.risk,
      mitigation: "Keep steps tied to explicit targets, constraints, and success criteria.",
    },
  ];
  if (evidence.constraints.length > 0) {
    risks.push({
      id: "risk-constraint-break",
      summary: `Required constraints may regress: ${evidence.constraints
        .slice(0, 2)
        .join("; ")}.`,
      severity: evidence.risk === "low" ? "medium" : evidence.risk,
      mitigation: "Treat each constraint as an acceptance check before completion.",
    });
  }
  if (changeImpact.includes("security")) {
    risks.push({
      id: "risk-security",
      summary: "Security-sensitive configuration or session handling may regress.",
      severity: evidence.risk === "critical" ? "critical" : "high",
      mitigation: "Review auth/session paths and failure modes explicitly.",
    });
  }
  if (changeImpact.includes("data")) {
    risks.push({
      id: "risk-data",
      summary: "Data or schema changes may be hard to reverse.",
      severity: evidence.risk === "critical" ? "critical" : "high",
      mitigation: "Require rollback notes and verification before apply.",
    });
  }
  return risks.slice(0, 8);
}

function buildAlternatives(
  evidence: PlanningTaskEvidence,
): PlanArtifact["alternatives"] {
  if (
    evidence.complexity === "trivial" ||
    evidence.complexity === "simple"
  ) {
    return [];
  }
  const alternatives: PlanArtifact["alternatives"] = [
    {
      id: "alt-minimal",
      summary: "Ship a narrower change limited to the highest-confidence targets first.",
      tradeoff: "Faster and safer, but may leave follow-up work.",
    },
  ];
  if (evidence.constraints.length > 0) {
    alternatives.push({
      id: "alt-constraint-first",
      summary: `Prioritize preserving constraints (${evidence.constraints
        .slice(0, 2)
        .join("; ")}) even if the feature slice is smaller.`,
      tradeoff: "Safer rollout, but the full requested outcome may need a second pass.",
    });
  }
  return alternatives.slice(0, 4);
}

function buildVerification(
  evidence: PlanningTaskEvidence,
): PlanArtifact["verification"] {
  const checks: string[] = [];
  // Generic check kinds (host/project adapters decide concrete commands).
  if (evidence.recommendsVerification !== false || isRepairIntent(evidence)) {
    checks.push("lint", "typecheck");
  }
  if (
    evidence.scope !== "single_location" ||
    evidence.risk === "high" ||
    evidence.risk === "critical"
  ) {
    checks.push("tests");
  }
  if (evidence.risk === "critical") {
    checks.push("build");
  }
  return {
    checks: uniqueStrings(checks),
    manualQa:
      evidence.risk === "high" || evidence.risk === "critical"
        ? ["Manually exercise the primary user-facing path."]
        : [],
    commands: [],
  };
}

function buildRollback(
  evidence: PlanningTaskEvidence,
  changeImpact: readonly PlanChangeImpact[],
): string | undefined {
  if (
    evidence.risk === "low" &&
    !changeImpact.includes("data") &&
    !changeImpact.includes("infra")
  ) {
    return "Revert the change set and re-run verification on the prior revision.";
  }
  return "Revert code/config changes, restore prior data/schema if touched, and re-run verification before retrying.";
}

function resolveChangeImpact(
  evidence: PlanningTaskEvidence,
): PlanChangeImpact[] {
  if (evidence.changeImpact.length > 0) {
    return [...evidence.changeImpact];
  }
  const inferred: PlanChangeImpact[] = ["code"];
  const blob = [
    evidence.primaryIntent,
    ...evidence.secondaryIntents,
    ...evidence.requestedOutcomes,
    ...evidence.constraints,
  ]
    .join(" ")
    .toLowerCase();
  if (/\b(config|env|setting|flag)\b/.test(blob)) inferred.push("config");
  if (/\b(schema|migrat|database|data)\b/.test(blob)) inferred.push("data");
  if (/\b(infra|deploy|kubernetes|terraform)\b/.test(blob)) inferred.push("infra");
  if (/\b(auth|sso|oidc|security|permission)\b/.test(blob)) {
    inferred.push("security");
  }
  if (/\b(ui|ux|frontend|css|layout)\b/.test(blob)) inferred.push("ux");
  return uniqueStrings(inferred) as PlanChangeImpact[];
}

function step(
  id: string,
  intent: string,
  targetRefs: readonly string[],
  actionSummary: string,
  expectedOutcome: string,
  riskLevel: PlanStep["riskLevel"],
  verification?: string,
): PlanStep {
  return {
    id,
    intent,
    targetRefs: [...targetRefs],
    actionSummary,
    expectedOutcome,
    verification,
    riskLevel,
  };
}

function acceptanceCriteria(
  evidence: PlanningTaskEvidence,
  objective: string,
  base: readonly string[],
): string[] {
  const targetRefs = evidence.targets.map((t) => t.value);
  const normalizedObjective = normalizePhraseKey(objective);
  const extras: string[] = [];
  const leftoverOutcomes: string[] = [];

  for (const outcome of evidence.requestedOutcomes) {
    const cleaned = sanitizeUserPhrase(outcome, targetRefs);
    if (cleaned.length < 8) continue;
    if (normalizePhraseKey(cleaned) === normalizedObjective) continue;
    leftoverOutcomes.push(cleaned);
  }

  // Objective already encodes the primary outcome. Only add Done when when a
  // leftover outcome is clearly preferred over the objective itself.
  const preferredAmong = pickPreferredPhrase([objective, ...leftoverOutcomes]);
  if (
    preferredAmong &&
    normalizePhraseKey(preferredAmong) !== normalizedObjective
  ) {
    extras.push(`Done when: ${clipPhrase(preferredAmong, 160)}`);
  }
  for (const constraint of evidence.constraints.slice(0, 2)) {
    extras.push(`Must still hold: ${clipPhrase(constraint, 160)}`);
  }
  return uniqueStrings([...base, ...extras]).slice(0, 6);
}

function doneOutcome(
  evidence: PlanningTaskEvidence,
  shortObjective: string,
): string {
  const constraintNote =
    evidence.constraints.length > 0
      ? ` Constraints remain true: ${evidence.constraints
          .slice(0, 2)
          .join("; ")}.`
      : "";
  return `"${shortObjective}" is met within scope.${constraintNote}`;
}

function specializeIntent(
  summary: string,
  targetRefs: readonly string[],
): string {
  const trimmed = summary.trim();
  if (targetRefs.length === 0) {
    return clipPhrase(trimmed, 200);
  }
  const first = targetRefs[0]!;
  if (trimmed.includes(first) || /\b(?:in|at|for|from)\s+\S+/i.test(trimmed)) {
    return clipPhrase(trimmed, 200);
  }
  return clipPhrase(`${trimmed}${scopeLabel(targetRefs)}`, 200);
}

function scopeLabel(targetRefs: readonly string[]): string {
  const refs = targetRefs
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .slice(0, 3);
  if (refs.length === 0) return "";
  if (refs.length === 1) return ` in ${refs[0]}`;
  if (refs.length === 2) return ` in ${refs[0]} and ${refs[1]}`;
  return ` in ${refs[0]} (+${refs.length - 1} more)`;
}

function intentActionVerb(primaryIntent: string): string {
  const intent = primaryIntent.trim().toLowerCase();
  if (intent.includes("bug") || intent.includes("fix")) return "Fix";
  if (intent.includes("refactor")) return "Refactor";
  if (intent.includes("migrat")) return "Migrate";
  if (intent.includes("test")) return "Cover";
  if (intent.includes("config") || intent.includes("depend")) return "Update";
  if (intent.includes("docs")) return "Document";
  if (intent.includes("secur")) return "Harden";
  if (intent.includes("optim")) return "Optimize";
  return "Implement";
}

function actionAwareIntent(
  verb: string,
  shortObjective: string,
  scope: string,
): string {
  const scopedObjective = shortObjective.includes(scope.trim()) || !scope
    ? shortObjective
    : /\b(?:in|at|for|from)\s+\S+/i.test(shortObjective)
      ? shortObjective
      : `${shortObjective}${scope}`;
  if (
    new RegExp(`^${escapeRegExp(verb)}\\b`, "i").test(scopedObjective) ||
    /^(?:fix|implement|add|update|resolve|refactor|migrate)\b/i.test(
      scopedObjective,
    )
  ) {
    return clipPhrase(scopedObjective, 200);
  }
  return clipPhrase(`${verb} ${scopedObjective}`, 200);
}

function shouldIncludeVerifyPhase(
  evidence: PlanningTaskEvidence,
): boolean {
  // Dimension-driven: honor explicit false except for repair intents.
  if (evidence.recommendsVerification === false) {
    return isRepairIntent(evidence);
  }
  return true;
}

/**
 * Repair-shaped work from request-understanding intent taxonomy only.
 * No language/tool/provider keyword sniffing.
 */
function isRepairIntent(evidence: PlanningTaskEvidence): boolean {
  const intents = [evidence.primaryIntent, ...evidence.secondaryIntents]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return intents.some(
    (intent) =>
      intent.includes("bug") ||
      intent.includes("fix") ||
      intent === "debug" ||
      intent.includes("diagnos"),
  );
}

/**
 * Strip chat @-mentions and repeated path noise from user/outcome text.
 */
function sanitizeUserPhrase(
  value: string,
  targetRefs: readonly string[] = [],
): string {
  let text = value.replace(/\r\n/g, "\n").trim();
  // Remove @path mentions used by hosts for attachments.
  text = text.replace(/(^|\s)@[^\s]+/g, " ");
  // Remove repeated absolute-ish path tokens when targets already carry them.
  for (const ref of targetRefs) {
    const escaped = escapeRegExp(ref.trim());
    if (!escaped) continue;
    text = text.replace(new RegExp(`(?:^|\\s)${escaped}(?=\\s|$)`, "gi"), " ");
  }
  text = text.replace(/\s+/g, " ").trim();
  // Drop leftover punctuation-only crumbs.
  text = text.replace(/^[,:;.\-_/]+/, "").replace(/[,:;.\-_/]+$/, "").trim();
  return text;
}

function pickPreferredPhrase(candidates: readonly string[]): string | undefined {
  if (candidates.length === 0) return undefined;
  const scored = candidates.map((phrase, index) => ({
    phrase,
    score:
      phrase.length +
      (/^(?:fix|resolve|add|implement|update|remove|refactor)\b/i.test(phrase)
        ? 40
        : 0) -
      (phrase.includes("@") ? 50 : 0) -
      index,
  }));
  scored.sort((left, right) => right.score - left.score);
  return scored[0]?.phrase;
}

function normalizePhraseKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clipPhrase(value: string, max: number): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1))}…`;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))];
}
