import type {
  PlanArtifact,
  PlanStrategyDecision,
  PlanningReasonCode,
} from "../contracts";
import {
  DEFAULT_MAX_PLAN_PHASES,
  DEFAULT_MAX_STEPS_PER_PHASE,
  DEFAULT_PLAN_CHARACTERS_PER_TOKEN,
} from "../defaults";
import { PLANNING_WORKING_SET_POLICY } from "../policy";

export interface CompactPlanResult {
  plan: PlanArtifact;
  usedTokens: number;
  compacted: boolean;
  reasonCodes: PlanningReasonCode[];
}

/**
 * Compact a plan to fit a soft token budget while preserving structure.
 */
export function compactPlan(params: {
  plan: PlanArtifact;
  budgetTokens: number;
  charactersPerToken?: number;
}): CompactPlanResult {
  const charactersPerToken =
    params.charactersPerToken ?? DEFAULT_PLAN_CHARACTERS_PER_TOKEN;
  const reasonCodes: PlanningReasonCode[] = [];

  let plan = params.plan;
  let serialized = serializePlanText(plan);
  let usedTokens = estimateTokens(serialized, charactersPerToken);
  let compacted = false;

  if (usedTokens <= params.budgetTokens) {
    return { plan, usedTokens, compacted, reasonCodes };
  }

  // Drop recoverable prose first so step targetRefs still fit the budget.
  plan = dropPlanProse(plan);
  compacted = true;
  serialized = serializePlanText(plan);
  usedTokens = estimateTokens(serialized, charactersPerToken);
  if (usedTokens <= params.budgetTokens) {
    reasonCodes.push("plan_compacted");
    return { plan, usedTokens, compacted, reasonCodes };
  }

  if (plan.phases.length > DEFAULT_MAX_PLAN_PHASES) {
    plan = {
      ...plan,
      phases: plan.phases.slice(0, DEFAULT_MAX_PLAN_PHASES),
    };
  }

  plan = {
    ...plan,
    phases: plan.phases.map((phase) => ({
      ...phase,
      steps: capCompactedPhaseSteps(phase.steps).map((step) => {
        const diagnostic = isDiagnosticBatchStep(step.id);
        return {
          ...step,
          actionSummary: truncate(step.actionSummary, diagnostic ? 80 : 240),
          expectedOutcome: truncate(step.expectedOutcome, diagnostic ? 80 : 160),
          intent: truncate(step.intent, 160),
        };
      }),
      purpose: truncate(phase.purpose, 200),
      successCriteria: phase.successCriteria.slice(0, 2),
    })),
  };

  serialized = serializePlanText(plan);
  usedTokens = estimateTokens(serialized, charactersPerToken);
  reasonCodes.push("plan_compacted");

  return { plan, usedTokens, compacted, reasonCodes };
}

function dropPlanProse(plan: PlanArtifact): PlanArtifact {
  return {
    ...plan,
    alternatives: [],
    rollback: undefined,
    assumptions: plan.assumptions.slice(0, 2).map((item) => truncate(item, 160)),
    openQuestions: plan.openQuestions.slice(0, 2).map((item) => truncate(item, 160)),
    risks: plan.risks.slice(0, 2).map((risk) => ({
      ...risk,
      summary: truncate(risk.summary, 160),
      mitigation: risk.mitigation ? truncate(risk.mitigation, 120) : undefined,
    })),
  };
}

export function serializePlanText(plan: PlanArtifact): string {
  const lines: string[] = [
    `Objective: ${plan.objective}`,
    `Scope: ${plan.dimensions.scope}; Risk: ${plan.dimensions.risk}; Clarity: ${plan.dimensions.clarity}; Complexity: ${plan.dimensions.complexity}`,
  ];

  if (plan.dimensions.changeImpact.length > 0) {
    lines.push(`Change impact: ${plan.dimensions.changeImpact.join(", ")}`);
  }
  if (plan.assumptions.length > 0) {
    lines.push("Assumptions:");
    for (const item of plan.assumptions) lines.push(`- ${item}`);
  }
  if (plan.openQuestions.length > 0) {
    lines.push("Open questions:");
    for (const item of plan.openQuestions) lines.push(`- ${item}`);
  }
  if (plan.constraints.length > 0) {
    lines.push("Constraints:");
    for (const item of plan.constraints) lines.push(`- ${item}`);
  }

  lines.push("Plan:");
  for (const [phaseIndex, phase] of plan.phases.entries()) {
    lines.push(`${phaseIndex + 1}. ${phase.name} — ${phase.purpose}`);
    if (phase.successCriteria.length > 0) {
      lines.push("   Acceptance:");
      for (const criterion of phase.successCriteria.slice(0, 4)) {
        lines.push(`   - ${criterion}`);
      }
    }
    for (const [stepIndex, step] of phase.steps.entries()) {
      lines.push(
        `   ${phaseIndex + 1}.${stepIndex + 1}. ${step.intent}: ${step.actionSummary}`,
      );
      if (step.targetRefs.length > 0) {
        lines.push(
          `       write: ${step.targetRefs.slice(0, 8).join(", ")}`,
        );
      }
      if (step.mustRead && step.mustRead.length > 0) {
        lines.push(`       need: ${step.mustRead.join(", ")}`);
      }
      if (step.affected && step.affected.length > 0) {
        lines.push(`       affected: ${step.affected.join(", ")}`);
      }
      if (step.expectedOutcome) {
        lines.push(`       Done when: ${step.expectedOutcome}`);
      }
    }
  }

  if (plan.alternatives.length > 0) {
    lines.push("Alternatives / tradeoffs:");
    for (const alternative of plan.alternatives) {
      lines.push(`- ${alternative.summary}`);
      if (alternative.tradeoff) {
        lines.push(`  But: ${alternative.tradeoff}`);
      }
    }
  }

  if (plan.risks.length > 0) {
    lines.push("Risks / ifs:");
    for (const risk of plan.risks) {
      const mitigation = risk.mitigation ? ` If so: ${risk.mitigation}` : "";
      lines.push(`- [${risk.severity}] ${risk.summary}${mitigation}`);
    }
  }
  if (plan.verification.checks.length > 0 || plan.verification.manualQa.length > 0) {
    lines.push(
      `Verification: ${[...plan.verification.checks, ...plan.verification.manualQa].join("; ")}`,
    );
  }
  if (plan.rollback) {
    lines.push(`Rollback: ${plan.rollback}`);
  }
  if (plan.approvalRequired) {
    lines.push("Approval: required before mutation.");
  }

  return lines.join("\n");
}

export function serializePlanForPrompt(
  plan: PlanArtifact,
  strategy?: PlanStrategyDecision,
): string {
  return [
    '<approved_plan trust="instruction">',
    serializePlanText(plan),
    "</approved_plan>",
    executionContract(strategy),
    "When reporting progress, reference the current plan step and verification from this plan.",
  ].join("\n");
}

export function formatPlanAsAnswer(plan: PlanArtifact): string {
  return serializePlanText(plan);
}

/**
 * Recover a conservative strategy when a host-carried or resumed plan has
 * no persisted PlanStrategyDecision. Prefers follow_evidence only when
 * Discover is absent and Change steps look file-scoped.
 */
export function inferPlanStrategyFromArtifact(
  plan: PlanArtifact,
): PlanStrategyDecision {
  const phaseNames = plan.phases.map((phase) => phase.name.toLowerCase());
  const hasDiscover = phaseNames.some((name) =>
    /discover|inspect|explore|investigate/.test(name),
  );
  const changeSteps = plan.phases
    .filter((phase) => /change|implement|fix|build|apply/.test(phase.name.toLowerCase()))
    .flatMap((phase) => phase.steps);
  const hasConcreteChange = changeSteps.some((step) =>
    /\.\w{1,16}\b|:\d{1,6}\b/.test(
      `${step.intent} ${step.targetRefs.join(" ")}`,
    ),
  );
  const looksLikeDiagnosticRepair = changeSteps.some((step) =>
    /\bTS\d+\b|:\d{1,6}\b/.test(`${step.intent} ${step.actionSummary}`),
  );
  const reviewedFiles = plan.contextReviewed.some(
    (ref) => ref.kind === "file" && /\.\w{1,16}$/.test(ref.ref),
  );

  if (hasDiscover) {
    return {
      schemaVersion: 1,
      strategy: "discover_and_plan",
      rationale: "Inferred from a Discover phase on the carried plan.",
      skipDiscover: false,
      useBuildEvidence: false,
    };
  }
  if (looksLikeDiagnosticRepair) {
    return {
      schemaVersion: 1,
      strategy: "follow_evidence",
      rationale: "Inferred from Change steps that cite diagnostic locations.",
      skipDiscover: true,
      useBuildEvidence: true,
    };
  }
  if (hasConcreteChange && reviewedFiles) {
    return {
      schemaVersion: 1,
      strategy: "discover_and_plan",
      rationale:
        "Inferred from a Change-only plan whose reviewed files show discovery already ran.",
      skipDiscover: true,
      useBuildEvidence: false,
    };
  }
  if (hasConcreteChange) {
    return {
      schemaVersion: 1,
      strategy: "plan_from_ask",
      rationale: "Inferred from file-scoped Change steps without diagnostic evidence.",
      skipDiscover: true,
      useBuildEvidence: false,
    };
  }
  return {
    schemaVersion: 1,
    strategy: "plan_from_ask",
    rationale: "Inferred from a plan without discovery or concrete diagnostic steps.",
    skipDiscover: true,
    useBuildEvidence: false,
  };
}

function estimateTokens(text: string, charactersPerToken: number): number {
  return Math.max(1, Math.ceil(text.length / charactersPerToken));
}

function isDiagnosticBatchStep(id: string): boolean {
  return id.startsWith("step-fix-diagnostic-");
}

function capCompactedPhaseSteps<T extends { id: string }>(steps: readonly T[]): T[] {
  const diagnostic = steps.filter((step) => isDiagnosticBatchStep(step.id));
  const other = steps.filter((step) => !isDiagnosticBatchStep(step.id));
  const keptDiagnostic = diagnostic.slice(
    0,
    PLANNING_WORKING_SET_POLICY.maxBatchesOnPlan,
  );
  const remaining = Math.max(0, 20 - keptDiagnostic.length);
  return [
    ...keptDiagnostic,
    ...other.slice(0, Math.min(DEFAULT_MAX_STEPS_PER_PHASE, remaining)),
  ];
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function executionContract(strategy?: PlanStrategyDecision): string {
  if (strategy?.strategy === "follow_evidence") {
    return [
      "Execution contract: preflight evidence already enumerates failures.",
      "Skip rediscovery. Start at the first Change step or active checklist item.",
      "Load only files for the active todo; mark it done before moving on.",
      "Do not expand scope unless the user revises the plan.",
    ].join(" ");
  }
  if (strategy?.strategy === "discover_and_plan") {
    return "Execution contract: discovery already ran. Start at the first Change step — do not rediscover. Complete each step before moving on, and do not expand scope unless the user revises the plan.";
  }
  if (strategy?.strategy === "plan_from_ask") {
    return "Execution contract: plan from the approved objective and listed targets. Start with the first unfinished step, complete each step before moving on, and do not expand scope unless the user revises the plan.";
  }
  if (strategy?.strategy === "clarify") {
    return "Execution contract: resolve the plan open questions before mutating files. Do not expand scope unless the user revises the plan.";
  }
  return "Execution contract: follow the approved plan phase by phase. Start with the first unfinished step, complete each step before moving on, and do not expand scope unless the user revises the plan.";
}
