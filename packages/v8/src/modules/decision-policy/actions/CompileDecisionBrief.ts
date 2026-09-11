import type { RequestUnderstandingResult } from "../../request-understanding";

import type { DecisionReasonCode, ExecutionDecision } from "../contracts";
import {
  decisionBriefSchema,
  type DecisionBrief,
} from "../contracts/output/DecisionBrief";

const REASON_PLAYBOOKS: Partial<Record<DecisionReasonCode, string>> = {
  mutation_execute:
    "Apply required edits with granted mutation tools; do not ask to switch modes when write tools are listed.",
  diagnosis_readonly:
    "Inspect and report findings only; do not claim you applied edits on this route.",
  change_impact_recommended:
    "Before the first mutating edit on shared surfaces, call analyze_change_impact on the primary seed and sequence patches from affected files.",
  clarification_material:
    "Ask the missing decision; do not guess act vs explain or invent targets.",
  grant_narrowed:
    "Stay inside narrowed path scopes; do not attempt out-of-scope writes.",
  mutation_budget_tight:
    "Batch small mutations; avoid broad drive-by refactors.",
  verification_required:
    "Plan verification evidence (tests/diagnostics/typecheck) before claiming done.",
  verification_run_requested:
    "Run or inspect tests with granted read-only process tools before answering pass/fail.",
  workspace_bug_execute:
    "Localize the workspace bug, then apply a minimal fix within granted scopes.",
  workspace_symptom_diagnose:
    "Diagnose the reported runtime symptom with tools before proposing mutations.",
  policy_facts_first:
    "Follow the classified interaction and task intent; do not reinterpret the grant.",
  policy_facts_heuristic_conflict_clarify:
    "Resolve the act-vs-explain / target ambiguity before mutating.",
  long_prompt_visible_plan:
    "Keep a concise visible plan aligned with executable Change/Verify work.",
  broad_repair_visible_plan:
    "Use a visible plan and live checklist for package-wide repair; avoid reactive patch loops alone.",
};

/**
 * Deterministic DecisionBrief compiler from ExecutionDecision + understanding.
 * Never invents tools or widens authority.
 */
export function compileDecisionBrief(params: {
  decision: ExecutionDecision;
  understanding?: RequestUnderstandingResult;
}): DecisionBrief {
  const { decision, understanding } = params;
  const grant = decision.toolGrant;
  const primary =
    understanding?.intent.classification.primaryTaskIntent ?? "task";
  const interaction =
    understanding?.intent.classification.interactionIntent ?? "unknown";
  const targets =
    understanding?.taskAnalysis.targets
      ?.map((t) => t.value)
      .filter((v) => v.trim().length > 0)
      .slice(0, 5) ?? [];

  const mustDo: string[] = [];
  const mustNotDo: string[] = [];
  const evidenceNeeded: string[] = [];
  const verification: string[] = [];
  const openRisks: string[] = [...decision.warnings].slice(0, 5);

  for (const code of decision.reasonCodes) {
    const playbook = REASON_PLAYBOOKS[code];
    if (playbook && !mustDo.includes(playbook)) {
      mustDo.push(playbook);
    }
  }

  if (
    decision.route === "direct_answer" ||
    decision.route === "repository_answer" ||
    decision.route === "diagnose" ||
    grant.maximumWorkspaceEffect !== "write"
  ) {
    mustNotDo.push(
      "Do not claim you are applying edits, adding files, or running a change now.",
    );
  }
  if (grant.allowedTools.length === 0) {
    mustNotDo.push("Do not invent tool use; answer from provided context only.");
  }
  if (decision.route === "clarify") {
    mustDo.push("Ask a concrete clarifying question; wait for the user choice.");
  }
  if (targets.length > 0) {
    evidenceNeeded.push(`Prefer named targets: ${targets.join(", ")}.`);
  }
  if (decision.repositoryContextRequired) {
    evidenceNeeded.push(
      "Ground answers in repository context or tool evidence before asserting file contents.",
    );
  }
  if (decision.verification.required) {
    for (const kind of decision.verification.minimumEvidence.slice(0, 6)) {
      verification.push(`Collect ${kind} evidence before finishing.`);
    }
  } else {
    verification.push("Verification not required for this decision.");
  }

  if (understanding?.taskAnalysis.clarity === "unclear") {
    openRisks.push("Task clarity is unclear — prefer evidence over assumptions.");
  }

  const mission =
    decision.route === "execute"
      ? `Complete the ${primary} request (${interaction}) within the granted write scopes.`
      : decision.route === "diagnose"
        ? `Diagnose the ${primary} request without mutating the workspace.`
        : decision.route === "plan"
          ? `Produce a concrete plan for the ${primary} request without executing mutations.`
          : decision.route === "clarify"
            ? `Clarify the material ambiguity before continuing.`
            : `Answer the ${primary} request on route ${decision.route}.`;

  const routeIntent = [
    `Route=${decision.route}`,
    `planningDepth=${decision.planningDepth}`,
    `planGate=${decision.planGate}`,
    `effect=${grant.maximumWorkspaceEffect}`,
    `approval=${grant.approvalMode}`,
  ].join("; ");

  const brief = decisionBriefSchema.parse({
    mission,
    routeIntent,
    mustDo: mustDo.slice(0, 8),
    mustNotDo: mustNotDo.slice(0, 8),
    evidenceNeeded: evidenceNeeded.slice(0, 8),
    verification: verification.slice(0, 8),
    openRisks: openRisks.slice(0, 8),
    authorityNote:
      "Tools and path scopes are fixed by Decision Policy. Do not reinterpret or widen the grant.",
  });

  return brief;
}

/** Format DecisionBrief as a trusted system/instruction block. */
export function formatDecisionBriefForPrompt(brief: DecisionBrief): string {
  const lines = [
    "## Decision brief",
    `Mission: ${brief.mission}`,
    `Route intent: ${brief.routeIntent}`,
  ];
  if (brief.mustDo.length > 0) {
    lines.push("Must do:");
    for (const item of brief.mustDo) lines.push(`- ${item}`);
  }
  if (brief.mustNotDo.length > 0) {
    lines.push("Must not do:");
    for (const item of brief.mustNotDo) lines.push(`- ${item}`);
  }
  if (brief.evidenceNeeded.length > 0) {
    lines.push("Evidence needed:");
    for (const item of brief.evidenceNeeded) lines.push(`- ${item}`);
  }
  if (brief.verification.length > 0) {
    lines.push("Verification:");
    for (const item of brief.verification) lines.push(`- ${item}`);
  }
  if (brief.openRisks.length > 0) {
    lines.push("Open risks:");
    for (const item of brief.openRisks) lines.push(`- ${item}`);
  }
  lines.push(brief.authorityNote);
  return lines.join("\n");
}
