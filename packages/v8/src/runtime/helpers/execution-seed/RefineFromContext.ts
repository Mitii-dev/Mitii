/**
 * After context retrieval: promote folder-only execution seeds to concrete
 * file paths from retrieved blocks.
 */
import type { ExecutionSeed } from "./ResolveExecutionSeed";
import { EXECUTION_SEED_MAX_PATHS } from "./ResolveExecutionSeed";
import { enrichUiWiringSeeds } from "./EnrichUiWiringSeeds";
import { enrichAuthMountSeeds } from "./EnrichAuthMountSeeds";
import {
  normalize,
  queryTokens,
  scorePath,
  uniqueCap,
  samePathSet,
  baseName,
} from "./RefineFromContextHelpers";

const FILE_LIKE = /\.[A-Za-z0-9]{1,12}$/;

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
  next = enrichAuthMountSeeds({
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
