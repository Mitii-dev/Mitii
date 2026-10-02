/**
 * After context retrieval: promote folder-only execution seeds to concrete
 * file paths from retrieved blocks (e.g. apps/desktop → SettingsPanel.tsx),
 * and bind composition wiring (App.tsx) for Index/settings navigation asks.
 */
import type { ExecutionSeed } from "./resolve";
import { EXECUTION_SEED_MAX_PATHS } from "./resolve";

const FILE_LIKE = /\.[A-Za-z0-9]{1,12}$/;
const UI_NAV_ASK =
  /\b(?:click(?:ing)?|redirect|open|navigat\w*|tab)\b/i;
const CHIP_OR_SETTINGS =
  /(?:IndexStatusChip|SettingsPanel)\.[A-Za-z0-9]+$/i;
const RENDERER_APP = /\/(?:renderer\/)?App\.(tsx|jsx|ts|js)$/i;

export function refineExecutionSeedFromContext(params: {
  seed: ExecutionSeed;
  contextPaths: readonly string[];
  userPrompt?: string;
  maxPaths?: number;
}): ExecutionSeed {
  const max = Math.max(1, params.maxPaths ?? EXECUTION_SEED_MAX_PATHS);
  let next = promoteFolderSeedToFiles(params, max);
  next = enrichUiWiringSeeds({
    seed: next,
    contextPaths: params.contextPaths,
    userPrompt: params.userPrompt,
    maxPaths: max,
  });
  return next;
}

function promoteFolderSeedToFiles(
  params: {
    seed: ExecutionSeed;
    contextPaths: readonly string[];
    userPrompt?: string;
  },
  max: number,
): ExecutionSeed {
  const seed = params.seed;
  if (seed.paths.length === 0 || params.contextPaths.length === 0) {
    return seed;
  }

  const folderSeeds = seed.paths
    .map(normalize)
    .filter((path) => path.length > 0 && !FILE_LIKE.test(baseName(path)));
  if (folderSeeds.length === 0) {
    return seed;
  }

  const underFolder = params.contextPaths
    .map(normalize)
    .filter(
      (path) =>
        FILE_LIKE.test(baseName(path)) &&
        folderSeeds.some(
          (folder) => path === folder || path.startsWith(`${folder}/`),
        ),
    );
  if (underFolder.length === 0) {
    return seed;
  }

  const tokens = queryTokens(params.userPrompt ?? "");
  const scored = underFolder
    .map((path) => ({
      path,
      score: scorePath(path, tokens),
    }))
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));

  const preferred = scored.filter((item) => item.score > 0).map((item) => item.path);
  const fallback = scored.map((item) => item.path);
  const chosen = (preferred.length > 0 ? preferred : fallback).slice(
    0,
    Math.min(6, max),
  );

  const existingFiles = seed.paths
    .map(normalize)
    .filter((path) => FILE_LIKE.test(baseName(path)));
  const paths = uniqueCap([...chosen, ...existingFiles], max);
  if (samePathSet(paths, seed.paths)) {
    return seed;
  }

  return {
    ...seed,
    paths,
    confidence: "trusted",
    source:
      seed.source === "none" || seed.source === "artifact"
        ? "mixed"
        : seed.source,
  };
}

/**
 * Index/settings click→tab asks are wired in the shell App, not only in the
 * chip/panel. When those surfaces are seeded, bind the sibling App.tsx even
 * if retrieval omitted it — otherwise mutate lock blocks finding the handler.
 */
export function enrichUiWiringSeeds(params: {
  seed: ExecutionSeed;
  contextPaths: readonly string[];
  userPrompt?: string;
  maxPaths: number;
}): ExecutionSeed {
  const seed = params.seed;
  const prompt = params.userPrompt?.trim() ?? "";
  if (!prompt || !UI_NAV_ASK.test(prompt)) {
    return seed;
  }

  const seedPaths = seed.paths.map(normalize).filter(Boolean);
  const hasUiSurface = seedPaths.some((path) => CHIP_OR_SETTINGS.test(path));
  if (!hasUiSurface) {
    return seed;
  }

  const fromContext = params.contextPaths
    .map(normalize)
    .filter((path) => RENDERER_APP.test(path));

  const synthesized: string[] = [];
  for (const path of seedPaths) {
    const rendererRoot = path.match(/^(.*\/renderer)\//i)?.[1];
    if (rendererRoot) {
      synthesized.push(`${rendererRoot}/App.tsx`);
    }
  }

  const toAdd = uniqueCap([...fromContext, ...synthesized], params.maxPaths);
  if (toAdd.length === 0) {
    return seed;
  }

  const paths = uniqueCap([...toAdd, ...seedPaths], params.maxPaths);
  if (samePathSet(paths, seed.paths)) {
    return seed;
  }

  return {
    ...seed,
    paths,
    confidence: "trusted",
    source:
      seed.source === "none" || seed.source === "artifact"
        ? "mixed"
        : seed.source,
  };
}

function queryTokens(prompt: string): string[] {
  return prompt
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter(
      (token) =>
        ![
          "the",
          "and",
          "for",
          "with",
          "from",
          "that",
          "this",
          "should",
          "properly",
          "upon",
          "clicking",
          "its",
        ].includes(token),
    );
}

function scorePath(path: string, tokens: readonly string[]): number {
  const lower = path.toLowerCase();
  const base = baseName(lower).replace(/\.[^.]+$/, "");
  let score = 0;
  for (const token of tokens) {
    if (base.includes(token) || lower.includes(token)) {
      score += token.length >= 5 ? 3 : 2;
    }
  }
  // Prefer renderer/UI surfaces for short UI asks when tokens match weakly.
  if (/\/renderer\//.test(lower) || /\.(tsx|jsx)$/.test(lower)) {
    score += 1;
  }
  return score;
}

function normalize(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

function baseName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function uniqueCap(values: readonly string[], max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

function samePathSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right.map((path) => path.toLowerCase()));
  return left.every((path) => rightSet.has(path.toLowerCase()));
}
