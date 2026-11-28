/**
 * Per active checklist step: evidence → patch readiness.
 */
import type { TaskList } from "../../../../modules/task-list";
import {
  isLoopFilePathFullyLoaded,
  type LoopFileReadTracker,
} from "../loop-file-reads/LoopFileReads";
import { normalizeRepoPathText } from "../../../../modules/repository-state";
import type { EstablishedFactRef } from "./EstablishedFactRef";

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

export function evaluateActiveStepMutateReadiness(params: {
  taskList?: TaskList;
  loopFileReads?: LoopFileReadTracker;
  establishedFacts?: readonly EstablishedFactRef[];
  maxEvidencePaths: number;
  /**
   * When true (execute/write), empty write/mustRead is NOT ready — use seedPaths
   * as synthetic needed or stay not-ready to avoid hallucinated patch demand.
   */
  mutationRequired?: boolean;
  /** Trusted execution-seed paths used when checklist write/mustRead are empty. */
  seedPaths?: readonly string[];
  /** When false/weak, never report ready for patch demand. */
  seedTrusted?: boolean;
}): ActiveStepMutateReadiness {
  const mutationRequired = params.mutationRequired === true;
  const seedTrusted = params.seedTrusted === true;
  const seedPaths = uniquePaths(params.seedPaths ?? []);
  const active = params.taskList?.items.find((item) => item.status === "active");

  if (!active) {
    if (mutationRequired) {
      if (seedTrusted && seedPaths.length > 0) {
        return readinessFromNeeded({
          writePaths: seedPaths,
          mustReadPaths: seedPaths,
          needed: seedPaths,
          maxEvidencePaths: params.maxEvidencePaths,
          loopFileReads: params.loopFileReads,
          establishedFacts: params.establishedFacts,
        });
      }
      return {
        ready: false,
        writePaths: [],
        mustReadPaths: [],
        missingPaths: seedPaths.slice(0, Math.max(1, params.maxEvidencePaths)),
        estFilesThisStep: Math.max(seedPaths.length, 1),
        estTurns: 1,
      };
    }
    return {
      ready: true,
      writePaths: [],
      mustReadPaths: [],
      missingPaths: [],
      estFilesThisStep: 0,
      estTurns: 0,
    };
  }

  let writePaths = uniquePaths(active.write ?? []);
  let mustReadPaths = uniquePaths(active.mustRead ?? []);
  if (
    mutationRequired &&
    writePaths.length === 0 &&
    seedTrusted &&
    seedPaths.length > 0
  ) {
    writePaths = seedPaths;
    if (mustReadPaths.length === 0) {
      mustReadPaths = seedPaths;
    }
  }
  const needed = uniquePaths([...mustReadPaths, ...writePaths]);
  const estFilesThisStep = Math.max(writePaths.length, needed.length > 0 ? 1 : 0);

  if (needed.length === 0) {
    // Mutation required without named surfaces — not ready (avoid patch hallucination).
    if (mutationRequired) {
      return {
        ready: false,
        activeItemId: active.id,
        activeTitle: active.title,
        writePaths,
        mustReadPaths,
        missingPaths: [],
        estFilesThisStep: 1,
        estTurns: 1,
      };
    }
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

  return readinessFromNeeded({
    activeItemId: active.id,
    activeTitle: active.title,
    writePaths,
    mustReadPaths,
    needed,
    maxEvidencePaths: params.maxEvidencePaths,
    loopFileReads: params.loopFileReads,
    establishedFacts: params.establishedFacts,
  });
}

function readinessFromNeeded(params: {
  activeItemId?: string;
  activeTitle?: string;
  writePaths: string[];
  mustReadPaths: string[];
  needed: string[];
  maxEvidencePaths: number;
  loopFileReads?: LoopFileReadTracker;
  establishedFacts?: readonly EstablishedFactRef[];
}): ActiveStepMutateReadiness {
  const missingPaths = params.needed
    .filter(
      (path) =>
        !isEvidencePathLoaded(path, params.loopFileReads, params.establishedFacts),
    )
    .slice(0, Math.max(1, params.maxEvidencePaths));

  return {
    ready: missingPaths.length === 0,
    activeItemId: params.activeItemId,
    activeTitle: params.activeTitle,
    writePaths: params.writePaths,
    mustReadPaths: params.mustReadPaths,
    missingPaths,
    estFilesThisStep: Math.max(params.writePaths.length, 1),
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
  establishedFacts?: readonly EstablishedFactRef[],
): boolean {
  const normalized = normalizeRepoPathText(path);
  if (!normalized) return false;
  // Truncated / windowed reads must not satisfy readiness — only eof+complete.
  if (isLoopFilePathFullyLoaded(loopFileReads, normalized)) {
    return true;
  }
  // Facts are a soft fallback only when the tracker has no entry for the path
  // (e.g. context from a prior turn). Never treat a truncated-read fact as load.
  if (loopFileReads?.byPath.has(normalized)) {
    return false;
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
    const normalized = normalizeRepoPathText(path);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

