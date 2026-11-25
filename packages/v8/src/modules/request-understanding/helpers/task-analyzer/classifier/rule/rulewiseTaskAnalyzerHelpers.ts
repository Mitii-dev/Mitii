import { TASK_ANALYZER_CONSTANTS } from "../../constants";
import type {
  PlanningHint,
  TaskAnalysisSignal,
  TaskAnalyzerInput,
  TaskClarity,
  TaskComplexity,
  TaskScope,
  TaskSize,
  TaskTarget,
} from "../../contracts";
import { defaultPlanningHintForSize } from "../../../intent/evidence/sizeDraft";

export function resolveTaskSizeAndPlanningHint(params: {
  officerTaskSize?: TaskSize;
  officerPlanningHint?: PlanningHint;
  sizeDraft?: TaskSize;
  complexity: TaskComplexity;
  interactionIntent: string;
  recommendsPlanning: boolean;
}): { taskSize: TaskSize; planningHint: PlanningHint } {
  const fromComplexity = ((): TaskSize => {
    switch (params.complexity) {
      case "trivial":
      case "simple":
        return "small";
      case "moderate":
        return "medium";
      case "complex":
      case "very_complex":
        return "large";
    }
  })();

  const taskSize =
    params.officerTaskSize ?? params.sizeDraft ?? fromComplexity;

  let planningHint =
    params.officerPlanningHint ?? defaultPlanningHintForSize(taskSize);

  if (params.interactionIntent === "plan" && planningHint === "none") {
    planningHint = taskSize === "large" ? "long" : "short";
  }
  // Always at least a short plan hint for act/plan (Officer "none" does not win).
  if (
    planningHint === "none" &&
    params.interactionIntent !== "question"
  ) {
    planningHint = defaultPlanningHintForSize(taskSize);
  }
  if (
    params.officerPlanningHint === "none" &&
    params.interactionIntent === "act" &&
    taskSize === "small"
  ) {
    planningHint = "short";
  }

  return { taskSize, planningHint };
}

/**
 * Deterministic targets win on duplicates; LLM hints only add missing ones.
 * Unverified file hints are demoted or dropped when a repo-map is present.
 */

export function mergeTargets(
  deterministic: readonly TaskTarget[],
  hinted: readonly TaskTarget[] | undefined,
  signals: TaskAnalysisSignal[],
  candidateRelativePaths: readonly string[],
): TaskTarget[] {
  const merged = [...deterministic];
  const seen = new Set(
    deterministic.map((target) => targetKey(target)),
  );
  const hasRepoMap = candidateRelativePaths.length > 0;
  const normalizedCandidates = hasRepoMap
    ? new Set(
        candidateRelativePaths.map((path) =>
          path.trim().replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase(),
        ),
      )
    : null;

  for (const hint of hinted ?? []) {
    const value = hint.value.trim();
    if (!value) {
      continue;
    }

    let explicit = hint.explicit;
    if (hint.kind === "file") {
      if (normalizedCandidates) {
        const key = value.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
        const inMap =
          normalizedCandidates.has(key) ||
          [...normalizedCandidates].some(
            (candidate) =>
              candidate.endsWith(`/${key}`) || candidate === key,
          );
        if (!inMap) {
          // Fuzzy may still resolve basename-only hints later; keep as
          // non-explicit so Decision Policy does not treat them as repo targets.
          explicit = false;
        }
      } else {
        explicit = false;
      }
    }

    const candidate: TaskTarget = {
      kind: hint.kind,
      value,
      explicit,
    };
    const key = targetKey(candidate);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(candidate);
    signals.push({
      type: "scope",
      value: `${candidate.kind}:${candidate.value}`,
      weight: candidate.explicit ? 0.5 : 0.35,
      evidence: candidate.explicit
        ? `LLM task hint added ${candidate.kind} target: ${candidate.value}`
        : `LLM task hint added unverified ${candidate.kind} target: ${candidate.value}`,
    });
  }

  return merged;
}


export function mergeUniqueStrings(
  deterministic: readonly string[],
  hinted: readonly string[] | undefined,
): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const value of [...deterministic, ...(hinted ?? [])]) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(normalized);
  }

  return merged;
}

/**
 * Prefer LLM `clear` when the Officer judged the ask clear — deterministic
 * clarity often marks repo-scale feature asks as unclear solely because no
 * file path was pinned yet, which wrongly opens harness A/B/C.
 * Otherwise keep the more conservative rating.
 */

export function mergeClarity(
  deterministic: TaskClarity,
  hinted: TaskClarity | undefined,
): TaskClarity {
  if (!hinted) {
    return deterministic;
  }
  if (hinted === "clear") {
    return "clear";
  }
  const rank: Record<TaskClarity, number> = {
    clear: 0,
    partially_clear: 1,
    unclear: 2,
  };
  return rank[hinted] > rank[deterministic] ? hinted : deterministic;
}


export function targetKey(target: TaskTarget): string {
  return `${target.kind}:${target.value.trim().toLowerCase()}`;
}


export function recommendsRepositoryDiscovery(
  primaryTaskIntent: TaskAnalyzerInput["intent"]["classification"]["primaryTaskIntent"],
  targetCount: number,
  scope: TaskScope,
  targets: ReadonlyArray<{ kind: string }>,
): boolean {
  if (
    scope === "repository" ||
    scope === "workspace" ||
    scope === "package" ||
    scope === "multi_file"
  ) {
    return true;
  }

  // Scope-level targets still need repository grounding.
  if (
    targets.some(
      (target) =>
        target.kind === "repository" ||
        target.kind === "workspace" ||
        target.kind === "package",
    )
  ) {
    return true;
  }

  // Concrete file/folder/symbol targets are routed via explicit targets
  // in Decision Policy; do not double-flag discovery.
  if (targetCount > 0) {
    return false;
  }

  return isIntentIncluded(
    primaryTaskIntent,
    TASK_ANALYZER_CONSTANTS.INTENT_DEFAULTS.REPOSITORY_DEPENDENT,
  );
}


export function isIntentIncluded(
  intent: TaskAnalyzerInput["intent"]["classification"]["primaryTaskIntent"],
  intents: readonly string[],
): boolean {
  return intents.includes(intent);
}


export function calculateOverallConfidence(input: {
  intentConfidence: number;
  constraintConfidence: number;
  hasConstraints: boolean;
  scopeConfidence: number;
  riskConfidence: number;
  clarityConfidence: number;
  complexity: TaskComplexity;
  complexitySignalCount: number;
}): number {
  const confidenceValues = [
    clamp(input.intentConfidence),
    clamp(input.scopeConfidence),
    clamp(input.riskConfidence),
    clamp(input.clarityConfidence),
    estimateComplexityConfidence(
      input.complexity,
      input.complexitySignalCount,
    ),
  ];

  /*
   * Absence of constraints is not uncertainty.
   * Include constraint confidence only when constraints were found.
   */
  if (input.hasConstraints) {
    confidenceValues.push(clamp(input.constraintConfidence));
  }

  const total = confidenceValues.reduce(
    (sum, confidence) => sum + confidence,
    0,
  );

  return clamp(total / confidenceValues.length);
}


export function estimateComplexityConfidence(
  complexity: TaskComplexity,
  signalCount: number,
): number {
  const thresholds = TASK_ANALYZER_CONSTANTS.THRESHOLDS.COMPLEXITY_CONFIDENCE;

  if (signalCount === 0) {
    return complexity === "simple" || complexity === "trivial"
      ? thresholds.EMPTY_SIMPLE
      : thresholds.EMPTY_OTHER;
  }

  return clamp(
    thresholds.BASE +
      Math.min(thresholds.MAX_BONUS, signalCount * thresholds.PER_SIGNAL),
  );
}


export function normalizeComplexitySignalScore(score: number): number {
  return clamp(
    Math.abs(score) /
      TASK_ANALYZER_CONSTANTS.THRESHOLDS.SIGNAL_NORMALIZATION
        .COMPLEXITY_DIVISOR,
  );
}


export function normalizeRiskSignalScore(score: number): number {
  return clamp(
    Math.abs(score) /
      TASK_ANALYZER_CONSTANTS.THRESHOLDS.SIGNAL_NORMALIZATION.RISK_DIVISOR,
  );
}


export function estimateFilesAffected(
  scope: TaskScope,
  complexity: TaskComplexity,
): {
  minimum: number;
  maximum?: number;
} {
  const impact = TASK_ANALYZER_CONSTANTS.FILE_IMPACT;

  switch (scope) {
    case "single_location":
      return {
        minimum: impact.single_location.minimum,
        maximum:
          complexity === "complex" || complexity === "very_complex"
            ? impact.single_location.complexMaximum
            : impact.single_location.defaultMaximum,
      };

    case "multi_file":
      return {
        minimum: impact.multi_file.minimum,
        maximum:
          complexity === "very_complex"
            ? impact.multi_file.veryComplexMaximum
            : complexity === "complex"
              ? impact.multi_file.complexMaximum
              : impact.multi_file.defaultMaximum,
      };

    case "package":
      return {
        minimum: impact.package.minimum,
        maximum:
          complexity === "very_complex"
            ? impact.package.veryComplexMaximum
            : impact.package.defaultMaximum,
      };

    case "repository":
      return {
        minimum: impact.repository.minimum,
        maximum:
          complexity === "very_complex"
            ? impact.repository.veryComplexMaximum
            : impact.repository.defaultMaximum,
      };

    case "workspace":
      return {
        minimum: impact.workspace.minimum,
      };

    case "unknown":
    default:
      return {
        minimum: impact.unknown.minimum,
      };
  }
}


export function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
