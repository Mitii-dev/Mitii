/**
 * After context retrieval: promote folder-only execution seeds to concrete
 * file paths from retrieved blocks (e.g. apps/desktop → SettingsPanel.tsx).
 */
import type { ExecutionSeed } from "./resolve";
import { EXECUTION_SEED_MAX_PATHS } from "./resolve";

const FILE_LIKE = /\.[A-Za-z0-9]{1,12}$/;

export function refineExecutionSeedFromContext(params: {
  seed: ExecutionSeed;
  contextPaths: readonly string[];
  userPrompt?: string;
  maxPaths?: number;
}): ExecutionSeed {
  const seed = params.seed;
  const max = Math.max(1, params.maxPaths ?? EXECUTION_SEED_MAX_PATHS);
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
