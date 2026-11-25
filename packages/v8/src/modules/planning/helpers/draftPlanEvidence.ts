import type {
  DiscoveryBrief,
  PlanArtifact,
  PlanChangeImpact,
  PlanContextRef,
  PlanningScopedRepoMap,
  PlanningTaskEvidence,
} from "../contracts";
import { clipPhrase, uniqueStrings } from "./draftPlanShared";
import {
  isPronounOnlyFollowUp,
  isRepairIntent,
  normalizePhraseKey,
  pickPreferredPhrase,
  sanitizeUserPhrase,
  scopeLabel,
} from "./draftPlanPhrases";
import {
  remapPathThroughScaffoldMapping,
  resolveScaffoldPackageMapping,
} from "./remapScaffoldChangeSurfaces";

export function buildObjective(
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

export function buildAssumptions(evidence: PlanningTaskEvidence): string[] {
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

export function resolveTargetRefs(
  evidence: PlanningTaskEvidence,
  discoveryBrief: DiscoveryBrief | undefined,
): string[] {
  const mapping = discoveryBrief
    ? resolveScaffoldPackageMapping({
        objective: discoveryBrief.objective,
        explicitTargets: discoveryBrief.targets,
        filesRead: discoveryBrief.filesRead,
      })
    : undefined;
  const fromDiscovery = [
    ...(discoveryBrief?.proposedChangeSurfaces.map((surface) => surface.path) ??
      []),
    ...(discoveryBrief?.targets
      .filter((target) => target.kind === "file" || target.kind === "test")
      .map((target) => target.value) ?? []),
  ]
    .map((path) =>
      mapping ? remapPathThroughScaffoldMapping(path, mapping) : path,
    )
    .filter((path) => {
      if (!mapping) return true;
      return (
        path === mapping.targetPrefix ||
        path.startsWith(`${mapping.targetPrefix}/`) ||
        (!path.startsWith(`${mapping.sourcePrefix}/`) &&
          path !== mapping.sourcePrefix)
      );
    });
  if (fromDiscovery.length > 0) {
    return uniqueStrings(fromDiscovery).slice(0, 12);
  }
  return evidence.targets.map((target) => target.value).slice(0, 12);
}

export function buildOpenQuestions(
  evidence: PlanningTaskEvidence,
  processHints: readonly string[] | undefined,
  discoveryBrief?: DiscoveryBrief,
  clarify = false,
): string[] {
  // File-backed discovery already grounded the ask — keep only discovery's
  // own open questions, not generic clarity/scope templates from understanding.
  if (
    !clarify &&
    discoveryBrief &&
    discoveryBrief.confidence !== "low" &&
    discoveryBrief.proposedChangeSurfaces.length > 0
  ) {
    return uniqueStrings(discoveryBrief.openQuestions).slice(0, 5);
  }
  const questions: string[] = [...(discoveryBrief?.openQuestions ?? [])];
  const scope = scopeLabel(evidence.targets.map((t) => t.value));
  if (
    clarify ||
    evidence.clarity === "unclear" ||
    evidence.clarity === "partially_clear"
  ) {
    questions.push(
      scope
        ? `For work${scope}: which outcome is in scope this turn, and what must stay unchanged?`
        : "Which outcome is in scope for this turn, and what should remain unchanged?",
    );
  }
  if (
    clarify ||
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

export function mergeContextReviewed(
  existing: readonly PlanContextRef[] | undefined,
  scopedRepoMap: PlanningScopedRepoMap | undefined,
  discoveryFiles?: readonly PlanContextRef[],
): PlanContextRef[] {
  const merged: PlanContextRef[] = [...(existing ?? [])];
  const seen = new Set(merged.map((item) => item.ref));
  for (const file of discoveryFiles ?? []) {
    const path = file.ref.trim();
    if (!path || seen.has(path)) {
      continue;
    }
    seen.add(path);
    merged.push(file);
    if (merged.length >= 40) {
      return merged;
    }
  }
  for (const entry of scopedRepoMap?.entries ?? []) {
    const path = entry.path.trim();
    if (!path || seen.has(path)) {
      continue;
    }
    seen.add(path);
    merged.push({
      kind: entry.kind === "folder" ? "folder" : "file",
      ref: path,
      ...(entry.note ? { note: entry.note } : {}),
    });
    if (merged.length >= 40) {
      break;
    }
  }
  return merged;
}

export function buildRisks(
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

export function buildAlternatives(
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

export function buildVerification(
  evidence: PlanningTaskEvidence,
  discoveryBrief?: DiscoveryBrief,
): PlanArtifact["verification"] {
  const checks: string[] = [];
  const commands: string[] = [];
  const manualQa: string[] = [];
  for (const hint of discoveryBrief?.verificationHints ?? []) {
    if (hint.kind === "manual") {
      manualQa.push(hint.reason);
    } else if (hint.kind !== "unknown") {
      checks.push(hint.kind === "test" ? "tests" : hint.kind);
    }
    if (hint.command) {
      commands.push(hint.command);
    }
  }
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
  if (evidence.risk === "high" || evidence.risk === "critical") {
    manualQa.push("Manually exercise the primary user-facing path.");
  }
  return {
    checks: uniqueStrings(checks),
    manualQa: uniqueStrings(manualQa),
    commands: uniqueStrings(commands),
  };
}

export function buildRollback(
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

export function resolveChangeImpact(
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

export function acceptanceCriteria(
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

export function doneOutcome(
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
