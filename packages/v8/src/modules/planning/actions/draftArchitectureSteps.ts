import type { PlanStep, PlanningTaskEvidence } from "../contracts";
import { DEFAULT_MAX_STEPS_PER_PHASE } from "../defaults";
import { clipPhrase, step } from "./draftPlanShared";

/**
 * Package/architecture refactors: one mega implement step collapses the
 * checklist. Split into concrete file-scoped workstreams when the ask is broad
 * and targets already look multi-surface (shared / platforms / specs).
 */
export function isArchitectureScaleAsk(
  evidence: PlanningTaskEvidence,
  objective: string,
): boolean {
  const broadScope =
    evidence.scope === "package" ||
    evidence.scope === "repository" ||
    evidence.scope === "workspace" ||
    evidence.scope === "multi_file";
  if (!broadScope) {
    return false;
  }
  const architectureIntent =
    evidence.primaryIntent === "refactor" ||
    evidence.primaryIntent === "migrate" ||
    evidence.primaryIntent === "scaffold";
  if (architectureIntent) {
    return true;
  }
  // Numbered multi-goal objectives (shared → adapters → specs) even if intent
  // was classified as feature.
  return extractNumberedGoalSteps(objective, [], evidence.risk).length >= 2;
}

export function buildArchitectureChangeSteps(
  evidence: PlanningTaskEvidence,
  objective: string,
  targetRefs: readonly string[],
  _processHints: readonly string[],
): PlanStep[] {
  if (!isArchitectureScaleAsk(evidence, objective)) {
    return [];
  }

  const numbered = extractNumberedGoalSteps(objective, targetRefs, evidence.risk);
  if (numbered.length >= 2) {
    return numbered.slice(0, DEFAULT_MAX_STEPS_PER_PHASE);
  }

  // Gate on primary intent only — architecture refactor/migrate must still
  // split Change steps even when secondary repair intents are present.
  const architectureIntent =
    evidence.primaryIntent === "refactor" ||
    evidence.primaryIntent === "migrate" ||
    evidence.primaryIntent === "scaffold";
  if (!architectureIntent) {
    return [];
  }

  const buckets = partitionTargetRefsForArchitecture(targetRefs);
  const steps: PlanStep[] = [];
  if (buckets.shared.length > 0) {
    steps.push(
      step(
        "step-shared-foundation",
        clipPhrase(`Build shared foundation under ${buckets.shared[0]}`, 200),
        buckets.shared,
        "Introduce or strengthen shared base helpers without breaking platform pages.",
        "Shared foundation compiles and is imported by platform adapters.",
        evidence.risk,
      ),
    );
  }
  if (buckets.platforms.length > 0) {
    steps.push(
      step(
        "step-platform-pages",
        clipPhrase(`Align platform page objects (${buckets.platforms.length} surfaces)`, 200),
        buckets.platforms,
        "Normalize Desktop/Tablet page APIs onto the shared foundation.",
        "Platform pages extend or compose the shared layer with stable imports.",
        evidence.risk,
      ),
    );
  }
  if (buckets.specs.length > 0) {
    steps.push(
      step(
        "step-specs-flows",
        clipPhrase(`Update specs and shared flows (${buckets.specs.length} surfaces)`, 200),
        buckets.specs,
        "Wire Cross/Desktop/Tablet specs through shared flows; keep smoke specs runnable.",
        "Specs import the new shared flows and pass type/diagnostics checks.",
        evidence.risk,
      ),
    );
  }
  // Require a real multi-surface split — a single folder must not replace
  // the normal implement step.
  if (steps.length < 2) {
    return [];
  }
  return steps.slice(0, DEFAULT_MAX_STEPS_PER_PHASE);
}

function extractNumberedGoalSteps(
  objective: string,
  targetRefs: readonly string[],
  risk: PlanningTaskEvidence["risk"],
): PlanStep[] {
  const matches = [
    ...objective.matchAll(
      /(?:^|\n)\s*(?:\d+[.)]|#{1,3}\s+)\s*([^\n]{12,160})/g,
    ),
  ];
  if (matches.length < 2) {
    return [];
  }
  return matches.slice(0, DEFAULT_MAX_STEPS_PER_PHASE).map((match, index) => {
    const goal = clipPhrase(match[1]!.trim(), 120);
    const scoped = pickTargetsForGoal(goal, targetRefs);
    return step(
      `step-goal-${index + 1}`,
      goal,
      scoped.length > 0 ? scoped : targetRefs.slice(0, 6),
      `Complete goal ${index + 1}: ${goal}`,
      `Goal ${index + 1} is implemented and checked.`,
      risk,
    );
  });
}

function pickTargetsForGoal(
  goal: string,
  targetRefs: readonly string[],
): string[] {
  const lower = goal.toLowerCase();
  const matched = targetRefs.filter((ref) => {
    const token = ref.toLowerCase();
    return (
      lower.includes(token) ||
      token.split("/").some((part) => part.length > 3 && lower.includes(part))
    );
  });
  return matched.slice(0, 8);
}

function partitionTargetRefsForArchitecture(targetRefs: readonly string[]): {
  shared: string[];
  platforms: string[];
  specs: string[];
} {
  const shared: string[] = [];
  const platforms: string[] = [];
  const specs: string[] = [];
  for (const ref of targetRefs) {
    const normalized = ref.replace(/\\/g, "/").toLowerCase();
    if (/(^|\/)shared(\/|$)/.test(normalized) || /(^|\/)common(\/|$)/.test(normalized)) {
      shared.push(ref);
    } else if (
      normalized.includes("/specs/") ||
      /(^|\/)specs(\/|$)/.test(normalized) ||
      normalized.includes(".spec.") ||
      normalized.includes(".test.")
    ) {
      specs.push(ref);
    } else if (
      /(^|\/)(desktop|tablet|mobile|pages)(\/|$)/.test(normalized)
    ) {
      platforms.push(ref);
    }
  }
  return { shared, platforms, specs };
}
