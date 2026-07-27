import type {
  PlanArtifact,
  PlanChangeImpact,
  PlanPhase,
  PlanStep,
  PlanningParsedInput,
  PlanningTaskEvidence,
} from "../contracts";
import { PLANNING_SCHEMA_VERSION } from "../constants";

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
  const phases = buildPhases({
    evidence,
    targetRefs,
    changeImpact,
    processHints: input.processHints ?? [],
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
  if (evidence.requestedOutcomes.length > 0) {
    return evidence.requestedOutcomes[0]!.slice(0, 1_000);
  }
  const trimmed = query.trim().replace(/\s+/g, " ");
  return trimmed.length > 0
    ? trimmed.slice(0, 1_000)
    : `Complete ${evidence.primaryIntent} safely within the stated scope.`;
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
  if (evidence.clarity === "unclear" || evidence.clarity === "partially_clear") {
    questions.push(
      "Which outcome is in scope for this turn, and what should remain unchanged?",
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
  targetRefs: readonly string[];
  changeImpact: readonly PlanChangeImpact[];
  processHints: readonly string[];
}): PlanPhase[] {
  const { evidence, targetRefs, changeImpact, processHints } = params;
  const needsDiscovery =
    evidence.scope === "package" ||
    evidence.scope === "repository" ||
    evidence.scope === "workspace" ||
    evidence.scope === "multi_file" ||
    evidence.complexity === "complex" ||
    evidence.complexity === "very_complex" ||
    evidence.recommendsPlanning === true;

  const phases: PlanPhase[] = [];

  if (needsDiscovery) {
    phases.push({
      id: "phase-discover",
      name: "Discover",
      purpose: "Inspect relevant context safely before changing anything.",
      dependencies: [],
      successCriteria: [
        "Relevant targets and constraints are identified.",
        "Blocking open questions are listed or resolved.",
      ],
      steps: [
        step(
          "step-locate",
          "Locate current behavior and extension points",
          targetRefs,
          "Search and read the relevant modules, configs, and tests.",
          "A bounded set of target refs and constraints is known.",
          "low",
        ),
        step(
          "step-evidence",
          "Collect evidence for impact and verification",
          targetRefs,
          "Review diffs, tests, APIs, or docs needed to judge risk.",
          "Enough evidence exists to draft a safe change sequence.",
          "low",
        ),
      ],
    });
  }

  phases.push({
    id: "phase-change",
    name: "Change",
    purpose: "Apply the smallest coherent set of changes for the objective.",
    dependencies: needsDiscovery ? ["phase-discover"] : [],
    successCriteria: [
      "Changes match the objective and constraints.",
      "No unrelated surfaces are modified.",
    ],
    steps: buildChangeSteps(evidence, targetRefs, changeImpact, processHints),
  });

  if (evidence.recommendsVerification !== false) {
    phases.push({
      id: "phase-verify",
      name: "Verify",
      purpose: "Prove the change with automated and manual checks.",
      dependencies: ["phase-change"],
      successCriteria: [
        "Applicable checks pass or failures are explained.",
        "Rollback notes remain valid.",
      ],
      steps: [
        step(
          "step-verify",
          "Run verification",
          targetRefs,
          "Execute lint/typecheck/tests/build or manual QA as required by risk.",
          "Verification evidence supports completion.",
          evidence.risk === "low" ? "low" : "medium",
          "tests, lint, typecheck, and/or manual QA",
        ),
      ],
    });
  }

  return phases;
}

function buildChangeSteps(
  evidence: PlanningTaskEvidence,
  targetRefs: readonly string[],
  changeImpact: readonly PlanChangeImpact[],
  processHints: readonly string[],
): PlanStep[] {
  const steps: PlanStep[] = [
    step(
      "step-design",
      "Choose a non-hardcoded extension approach",
      targetRefs,
      "Prefer existing seams and configurable boundaries over vendor- or type-specific hardcoding.",
      "An approach that preserves existing behavior is selected.",
      evidence.risk,
    ),
    step(
      "step-implement",
      "Implement the change at identified targets",
      targetRefs,
      summarizeImplementAction(changeImpact, processHints),
      "The objective is met within constraints.",
      evidence.risk,
    ),
  ];

  if (changeImpact.includes("security") || changeImpact.includes("data")) {
    steps.push(
      step(
        "step-safeguard",
        "Apply safeguards for high-impact surfaces",
        targetRefs,
        "Account for auth, data integrity, and failure modes before finishing.",
        "High-impact failure modes have explicit handling.",
        evidence.risk === "low" ? "medium" : evidence.risk,
      ),
    );
  }

  return steps;
}

function summarizeImplementAction(
  changeImpact: readonly PlanChangeImpact[],
  processHints: readonly string[],
): string {
  const impact =
    changeImpact.length > 0 ? changeImpact.join(", ") : "code";
  const hintNote =
    processHints.length > 0
      ? ` Consider process hints: ${processHints.join(", ")}.`
      : "";
  return `Apply changes across impact surfaces (${impact}) without hard-coding a single plan type.${hintNote}`;
}

function buildRisks(
  evidence: PlanningTaskEvidence,
  changeImpact: readonly PlanChangeImpact[],
): PlanArtifact["risks"] {
  const risks: PlanArtifact["risks"] = [
    {
      id: "risk-scope-creep",
      summary: "Changes may expand beyond the intended scope.",
      severity: evidence.risk === "low" ? "medium" : evidence.risk,
      mitigation: "Keep steps tied to explicit targets and success criteria.",
    },
  ];
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
  return [
    {
      id: "alt-minimal",
      summary: "Ship a narrower change limited to the highest-confidence targets first.",
      tradeoff: "Faster and safer, but may leave follow-up work.",
    },
  ];
}

function buildVerification(
  evidence: PlanningTaskEvidence,
): PlanArtifact["verification"] {
  const checks: string[] = [];
  if (evidence.recommendsVerification !== false) {
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
    checks,
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

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))];
}
