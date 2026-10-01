/**
 * Per active checklist step: evidence → patch readiness.
 * Plan scopes steps; execution of a step gathers named evidence then patches.
 * Never claims workspace edits are done.
 */
import type { TaskList } from "../../../../modules/task-list";
import type { EstablishedFact } from "../../actions/extractEstablishedFact";
import type { LoopFileReadTracker } from "../../actions/isExplorationRereadHeavy";

export type MutateReadinessTaskSize = "small" | "medium" | "large";

export type MutateReadinessBudget = {
  /** Readonly tool turns on the active step before firing the gate. */
  readonlyTurnsBeforeGate: number;
  /** Cap on RequiredEvidenceBeforePatch paths. */
  maxEvidencePaths: number;
  /**
   * How many times we may demand named reads before escalating to
   * “patch now” even if some paths are still missing (soft, not a hard lock).
   */
  maxEvidenceGateNudgesBeforePatchDemand: number;
};

export type ActiveStepMutateReadiness = {
  ready: boolean;
  activeItemId?: string;
  activeTitle?: string;
  writePaths: string[];
  mustReadPaths: string[];
  /** Paths still needed before patching this step (capped). */
  missingPaths: string[];
  /** Estimate of files this step intends to change. */
  estFilesThisStep: number;
  /** Suggested turns to load missing evidence (1 when anything missing). */
  estTurns: number;
};

export function resolveMutateReadinessBudget(
  taskSize: MutateReadinessTaskSize | string | undefined,
): MutateReadinessBudget {
  switch (taskSize) {
    case "large":
      return {
        readonlyTurnsBeforeGate: 5,
        maxEvidencePaths: 6,
        maxEvidenceGateNudgesBeforePatchDemand: 2,
      };
    case "medium":
      return {
        readonlyTurnsBeforeGate: 4,
        maxEvidencePaths: 5,
        maxEvidenceGateNudgesBeforePatchDemand: 2,
      };
    case "small":
    default:
      return {
        readonlyTurnsBeforeGate: 2,
        maxEvidencePaths: 2,
        maxEvidenceGateNudgesBeforePatchDemand: 1,
      };
  }
}

/**
 * Prefer the tighter of size-shaped gate and post-plan soft-nudge threshold.
 */
export function resolveStepReadonlyTurnsBeforeGate(params: {
  taskSize?: MutateReadinessTaskSize | string;
  hasPlan: boolean;
  maxReadOnlyTurnsBeforeMutationNudgeAfterPlan: number;
}): number {
  const sizeBudget = resolveMutateReadinessBudget(params.taskSize);
  if (!params.hasPlan) {
    return sizeBudget.readonlyTurnsBeforeGate;
  }
  return Math.min(
    sizeBudget.readonlyTurnsBeforeGate,
    params.maxReadOnlyTurnsBeforeMutationNudgeAfterPlan,
  );
}

export function evaluateActiveStepMutateReadiness(params: {
  taskList?: TaskList;
  loopFileReads?: LoopFileReadTracker;
  establishedFacts?: readonly EstablishedFact[];
  maxEvidencePaths: number;
}): ActiveStepMutateReadiness {
  const active = params.taskList?.items.find((item) => item.status === "active");
  if (!active) {
    return {
      ready: true,
      writePaths: [],
      mustReadPaths: [],
      missingPaths: [],
      estFilesThisStep: 0,
      estTurns: 0,
    };
  }

  const writePaths = uniquePaths(active.write ?? []);
  const mustReadPaths = uniquePaths(active.mustRead ?? []);
  const needed = uniquePaths([...mustReadPaths, ...writePaths]);
  const estFilesThisStep = Math.max(writePaths.length, needed.length > 0 ? 1 : 0);

  if (needed.length === 0) {
    // No named surfaces — treat as ready so soft patch demand can fire.
    return {
      ready: true,
      activeItemId: active.id,
      activeTitle: active.title,
      writePaths,
      mustReadPaths,
      missingPaths: [],
      estFilesThisStep: Math.max(estFilesThisStep, 1),
      estTurns: 0,
    };
  }

  const missingPaths = needed
    .filter(
      (path) =>
        !isEvidencePathLoaded(path, params.loopFileReads, params.establishedFacts),
    )
    .slice(0, Math.max(1, params.maxEvidencePaths));

  return {
    ready: missingPaths.length === 0,
    activeItemId: active.id,
    activeTitle: active.title,
    writePaths,
    mustReadPaths,
    missingPaths,
    estFilesThisStep: Math.max(estFilesThisStep, 1),
    estTurns: missingPaths.length > 0 ? 1 : 0,
  };
}

export function shouldDemandEvidenceBeforePatch(params: {
  readiness: ActiveStepMutateReadiness;
  evidenceGateNudges: number;
  maxEvidenceGateNudgesBeforePatchDemand: number;
}): boolean {
  if (params.readiness.ready || params.readiness.missingPaths.length === 0) {
    return false;
  }
  return (
    params.evidenceGateNudges <
    params.maxEvidenceGateNudgesBeforePatchDemand
  );
}

/**
 * Structured gate: load only these paths, then patch this step.
 * Explicitly refuses “edits are done” language.
 */
export function buildStepEvidenceGateMessage(
  readiness: ActiveStepMutateReadiness,
): string {
  const step =
    readiness.activeTitle?.trim() ||
    readiness.activeItemId ||
    "active checklist step";
  const missing = readiness.missingPaths.map((path) => `- ${path}`).join("\n");
  return [
    `Active checklist step: "${step}"${readiness.activeItemId ? ` (${readiness.activeItemId})` : ""}`,
    "enough_to_patch: false",
    "RequiredEvidenceBeforePatch:",
    missing,
    `est_files_this_step: ${readiness.estFilesThisStep}`,
    `est_turns: ${Math.max(1, readiness.estTurns)}`,
    "Call read_file or read_many_files ONLY for those paths, then apply_patch for this step.",
    "Do not expand into list_directory / glob_files / broad search.",
    "Workspace edits are NOT done until apply_patch lands for this step.",
  ].join("\n");
}

/**
 * Evidence for this step is loaded — demand the patch, do not rediscover.
 */
export function buildStepPatchRequiredMessage(
  readiness: ActiveStepMutateReadiness,
): string {
  const step =
    readiness.activeTitle?.trim() ||
    readiness.activeItemId ||
    "active checklist step";
  const write =
    readiness.writePaths.length > 0
      ? readiness.writePaths.slice(0, 8).join(", ")
      : "(paths named on the active checklist row)";
  return [
    `Active checklist step: "${step}"${readiness.activeItemId ? ` (${readiness.activeItemId})` : ""}`,
    "enough_to_patch: true",
    `write_targets: ${write}`,
    `est_files_this_step: ${Math.max(1, readiness.estFilesThisStep)}`,
    "Required evidence for this step is loaded. Call apply_patch NOW for this step.",
    "Do not keep rediscovering. Workspace edits are NOT done until that patch lands.",
  ].join("\n");
}

function isEvidencePathLoaded(
  path: string,
  loopFileReads?: LoopFileReadTracker,
  establishedFacts?: readonly EstablishedFact[],
): boolean {
  const normalized = normalizePath(path);
  if (!normalized) return false;
  if (loopFileReads) {
    for (const candidate of loopFileReads.paths) {
      if (normalizePath(candidate) === normalized) {
        return true;
      }
    }
  }
  for (const fact of establishedFacts ?? []) {
    if (fact.id.includes(normalized) || fact.content.includes(normalized)) {
      return true;
    }
  }
  return false;
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const path of paths) {
    const normalized = normalizePath(path);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function normalizePath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}
