/**
 * After a concrete plan is locked: promote Change-step targetRefs into a
 * trusted execution seed so mutate lock does not stall on "no file seed"
 * for clear feature asks that never cited a path in the prompt.
 */

import type { PlanArtifact } from "../../../../modules/planning";

import {
  EXECUTION_SEED_MAX_PATHS,
  type ExecutionSeed,
} from "./resolve";

const FILE_LIKE = /\.[A-Za-z0-9]{1,16}$/;
const NOISE_PATH =
  /(?:^|\/)(?:\.mitii|\.git|node_modules|dist|build|coverage)(?:\/|$)/i;
const NOISE_BASENAME =
  /^(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|\.gitignore|\.DS_Store)$/i;

/**
 * Merge file-scoped plan Change targets into the execution seed and mark
 * trusted when at least one editable surface is present.
 */
export function refineExecutionSeedFromPlan(params: {
  seed: ExecutionSeed | undefined;
  plan: PlanArtifact;
  maxPaths?: number;
}): ExecutionSeed {
  const max = Math.max(1, params.maxPaths ?? EXECUTION_SEED_MAX_PATHS);
  const fromPlan = collectPlanChangePaths(params.plan);
  const prior = (params.seed?.paths ?? []).map(normalize).filter(Boolean);
  const merged = uniqueCap([...fromPlan, ...prior], max);
  const editable = merged.filter(isEditableSurface);

  if (editable.length === 0) {
    return (
      params.seed ?? {
        paths: [],
        symbols: [],
        causeNotes: [],
        confidence: "weak",
        source: "none",
      }
    );
  }

  const priorTrusted =
    params.seed?.confidence === "trusted" &&
    (params.seed.paths.length > 0 || params.seed.symbols.length > 0);
  if (
    priorTrusted &&
    samePathSet(editable, params.seed!.paths.map(normalize).filter(Boolean))
  ) {
    return params.seed!;
  }

  return {
    paths: editable,
    symbols: [...(params.seed?.symbols ?? [])],
    causeNotes: [...(params.seed?.causeNotes ?? [])],
    confidence: "trusted",
    source:
      params.seed && params.seed.source !== "none"
        ? params.seed.source === "user"
          ? "mixed"
          : params.seed.source
        : "artifact",
  };
}

function collectPlanChangePaths(plan: PlanArtifact): string[] {
  const out: string[] = [];
  for (const phase of plan.phases ?? []) {
    const phaseName = `${phase.id ?? ""} ${phase.name ?? ""}`;
    const isChange = /change|implement|edit|add|update|write/i.test(phaseName);
    for (const step of phase.steps ?? []) {
      const stepBlob = `${step.id ?? ""} ${step.intent ?? ""} ${step.actionSummary ?? ""}`;
      if (!isChange && !/change|implement|edit|add|update|write|fix|create/i.test(stepBlob)) {
        continue;
      }
      for (const ref of step.targetRefs ?? []) {
        const path = normalize(ref);
        if (path) {
          pushUnique(out, path, EXECUTION_SEED_MAX_PATHS * 2);
        }
      }
    }
  }
  return out;
}

function isEditableSurface(path: string): boolean {
  if (!path || NOISE_PATH.test(path)) return false;
  const base = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  if (NOISE_BASENAME.test(base)) return false;
  // Prefer real files; allow folders that look like packages/src roots.
  if (FILE_LIKE.test(base)) return true;
  return /(?:^|\/)(?:src|test|tests|scripts|apps|packages|config)(?:\/|$)/i.test(
    path,
  );
}

function normalize(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function pushUnique(list: string[], value: string, max: number): void {
  if (list.includes(value) || list.length >= max) return;
  list.push(value);
}

function uniqueCap(values: readonly string[], max: number): string[] {
  const out: string[] = [];
  for (const value of values) {
    pushUnique(out, value, max);
  }
  return out;
}

function samePathSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const set = new Set(left);
  return right.every((path) => set.has(path));
}
