import type {
  DiscoveredPlanDraft,
  DiscoveredPlanStep,
  PlanArtifact,
  PlanPhase,
  PlanStep,
  PlanningParsedInput,
} from "../contracts";
import { DEFAULT_MAX_STEPS_PER_PHASE } from "../defaults";
import { filterBuildEvidenceToAskScope } from "../internal/evidenceScope";

/**
 * Apply a `discover_and_plan` model draft onto the deterministic discovery
 * skeleton. Change+Verify steps are replaced (not index-overwritten) so the
 * model can add or drop rows. The skeleton already has no Discover phase
 * because the strategy set `skipDiscover: true`.
 */
export function applyDiscoveredPlanDraft(params: {
  skeleton: PlanArtifact;
  draft: DiscoveredPlanDraft;
  input: PlanningParsedInput;
}): PlanArtifact {
  const allowlist = buildTargetAllowlist(params.input);
  const grouped = groupByPhase(params.draft, allowlist);
  const phases = params.skeleton.phases.map((phase) =>
    replacePhaseSteps({
      phase,
      entries: grouped.get(phaseKind(phase)) ?? [],
    }),
  );

  return {
    ...params.skeleton,
    objective:
      params.draft.objective && params.draft.objective.trim().length > 0
        ? params.draft.objective.trim()
        : params.skeleton.objective,
    openQuestions:
      params.draft.openQuestions && params.draft.openQuestions.length > 0
        ? uniqueStrings([
            ...params.skeleton.openQuestions,
            ...params.draft.openQuestions.map((question) => question.trim()),
          ]).slice(0, 8)
        : params.skeleton.openQuestions,
    phases,
  };
}

function replacePhaseSteps(params: {
  phase: PlanPhase;
  entries: DiscoveredPlanStep[];
}): PlanPhase {
  if (params.entries.length === 0) {
    return params.phase;
  }
  const fallbackRisk = params.phase.steps[0]?.riskLevel ?? "low";
  const fallbackTargets = params.phase.steps[0]?.targetRefs ?? [];
  const steps: PlanStep[] = params.entries
    .slice(0, DEFAULT_MAX_STEPS_PER_PHASE)
    .map((entry, index) => ({
      id: `${params.phase.id}-draft-${index + 1}`.slice(0, 64),
      intent: entry.intent,
      actionSummary: entry.actionSummary,
      targetRefs:
        entry.targetRefs.length > 0 ? entry.targetRefs : [...fallbackTargets],
      expectedOutcome: entry.expectedOutcome,
      riskLevel: fallbackRisk,
    }));
  return { ...params.phase, steps };
}

function groupByPhase(
  draft: DiscoveredPlanDraft,
  allowlist: readonly string[],
): Map<DiscoveredPlanStep["phaseHint"], DiscoveredPlanStep[]> {
  const grouped = new Map<DiscoveredPlanStep["phaseHint"], DiscoveredPlanStep[]>();
  for (const step of draft.steps) {
    const entry: DiscoveredPlanStep = {
      phaseHint: step.phaseHint,
      intent: step.intent.trim(),
      actionSummary: step.actionSummary.trim(),
      targetRefs: filterTargetRefs(step.targetRefs, allowlist),
      expectedOutcome: step.expectedOutcome.trim(),
    };
    const existing = grouped.get(step.phaseHint) ?? [];
    existing.push(entry);
    grouped.set(step.phaseHint, existing);
  }
  return grouped;
}

function buildTargetAllowlist(input: PlanningParsedInput): string[] {
  const scopedDiagnostics =
    filterBuildEvidenceToAskScope({
      buildEvidence: input.buildEvidence,
      targets: input.evidence.targets,
      query: input.query,
    })?.diagnostics ?? [];
  return uniqueStrings(
    [
      ...(input.scopedRepoMap?.entries.map((entry) => entry.path) ?? []),
      ...(input.discoveryBrief?.filesRead.map((file) => file.path) ?? []),
      ...(input.discoveryBrief?.proposedChangeSurfaces.map((surface) => surface.path) ??
        []),
      ...(input.discoveryBrief?.targets.map((target) => target.value) ?? []),
      ...scopedDiagnostics.map((diagnostic) => diagnostic.path),
      ...input.evidence.targets
        .filter((target) => target.explicit)
        .map((target) => target.value),
    ].map(normalizePath),
  ).filter((value) => value.length > 0);
}

function filterTargetRefs(
  targetRefs: readonly string[],
  allowlist: readonly string[],
): string[] {
  const normalized = targetRefs.map(normalizePath).filter(Boolean);
  if (allowlist.length === 0) {
    return uniqueStrings(normalized).slice(0, 8);
  }
  return uniqueStrings(
    normalized.filter((targetRef) =>
      allowlist.some((allowed) => pathOverlaps(targetRef, allowed)),
    ),
  ).slice(0, 8);
}

function phaseKind(phase: PlanPhase): DiscoveredPlanStep["phaseHint"] {
  const normalized = phase.name.toLowerCase();
  return /verify|test|check/.test(normalized) ? "verify" : "change";
}

function pathOverlaps(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function normalizePath(value: string): string {
  return value
    .trim()
    .replace(/^@+/, "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}
