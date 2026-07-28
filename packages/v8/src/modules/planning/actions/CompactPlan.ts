import type { PlanArtifact, PlanningReasonCode } from "../contracts";
import {
  DEFAULT_MAX_PLAN_PHASES,
  DEFAULT_MAX_STEPS_PER_PHASE,
  DEFAULT_PLAN_CHARACTERS_PER_TOKEN,
} from "../defaults";

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

  // Drop alternatives first, then trim phases/steps.
  if (plan.alternatives.length > 0) {
    plan = { ...plan, alternatives: [] };
    compacted = true;
  }

  if (plan.phases.length > DEFAULT_MAX_PLAN_PHASES) {
    plan = {
      ...plan,
      phases: plan.phases.slice(0, DEFAULT_MAX_PLAN_PHASES),
    };
    compacted = true;
  }

  plan = {
    ...plan,
    phases: plan.phases.map((phase) => ({
      ...phase,
      steps: phase.steps.slice(0, DEFAULT_MAX_STEPS_PER_PHASE).map((step) => ({
        ...step,
        actionSummary: truncate(step.actionSummary, 240),
        expectedOutcome: truncate(step.expectedOutcome, 160),
        intent: truncate(step.intent, 160),
      })),
      purpose: truncate(phase.purpose, 200),
      successCriteria: phase.successCriteria.slice(0, 4),
    })),
    assumptions: plan.assumptions.slice(0, 4).map((a) => truncate(a, 200)),
    openQuestions: plan.openQuestions.slice(0, 3).map((q) => truncate(q, 200)),
    risks: plan.risks.slice(0, 4).map((risk) => ({
      ...risk,
      summary: truncate(risk.summary, 200),
      mitigation: risk.mitigation
        ? truncate(risk.mitigation, 160)
        : undefined,
    })),
    rollback: plan.rollback ? truncate(plan.rollback, 280) : undefined,
  };
  compacted = true;

  serialized = serializePlanText(plan);
  usedTokens = estimateTokens(serialized, charactersPerToken);
  if (compacted) {
    reasonCodes.push("plan_compacted");
  }

  return { plan, usedTokens, compacted, reasonCodes };
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
    for (const [stepIndex, step] of phase.steps.entries()) {
      lines.push(
        `   ${phaseIndex + 1}.${stepIndex + 1}. ${step.intent}: ${step.actionSummary}`,
      );
    }
  }

  if (plan.risks.length > 0) {
    lines.push("Risks:");
    for (const risk of plan.risks) {
      lines.push(`- [${risk.severity}] ${risk.summary}`);
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

export function serializePlanForPrompt(plan: PlanArtifact): string {
  return [
    '<approved_plan trust="instruction">',
    serializePlanText(plan),
    "</approved_plan>",
    "Execution contract: follow the approved plan phase by phase. Start with the first unfinished step, complete each step before moving on, and do not expand scope unless the user revises the plan.",
    "When reporting progress, reference the current plan step and verification from this plan.",
  ].join("\n");
}

export function formatPlanAsAnswer(plan: PlanArtifact): string {
  return serializePlanText(plan);
}

function estimateTokens(text: string, charactersPerToken: number): number {
  return Math.max(1, Math.ceil(text.length / charactersPerToken));
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}
