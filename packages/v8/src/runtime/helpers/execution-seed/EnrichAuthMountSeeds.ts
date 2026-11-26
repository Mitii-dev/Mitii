/**
 * Login/bearer asks need the route and where it is registered.
 */
import type { ExecutionSeed } from "./ResolveExecutionSeed";
import {
  normalize,
  samePathSet,
  uniqueCap,
} from "./RefineFromContextHelpers";

const AUTH_ROUTE =
  /(?:^|\/)(?:routes?\/)?(?:login|auth|users)\.(?:js|ts|mjs|cjs)$/i;
const AUTH_ASK =
  /\b(?:login|bearer|token|auth(?:enticat\w*)?|password|jwt)\b/i;
const APP_MOUNT =
  /(?:^|\/)(?:index|app|server|main)\.(?:js|ts|mjs|cjs)$/i;

export function enrichAuthMountSeeds(params: {
  seed: ExecutionSeed;
  contextPaths: readonly string[];
  userPrompt?: string;
  maxPaths: number;
}): ExecutionSeed {
  const seed = params.seed;
  const prompt = params.userPrompt?.trim() ?? "";
  if (prompt && !AUTH_ASK.test(prompt)) {
    return seed;
  }

  const seedPaths = seed.paths.map(normalize).filter(Boolean);
  const hasAuthRoute = seedPaths.some((path) => AUTH_ROUTE.test(path));
  if (!hasAuthRoute && !(prompt && AUTH_ASK.test(prompt))) {
    return seed;
  }
  if (!hasAuthRoute) {
    return seed;
  }

  const fromContext = params.contextPaths
    .map(normalize)
    .filter((path) => APP_MOUNT.test(path));

  const synthesized: string[] = [];
  for (const path of seedPaths) {
    if (!AUTH_ROUTE.test(path)) continue;
    const root = path.match(/^(.*\/)(?:src\/)?routes?\//i)?.[1];
    if (root) {
      synthesized.push(
        `${root}index.js`,
        `${root}src/index.js`,
        `${root}app.js`,
        `${root}server.js`,
      );
    }
  }

  const toAdd = uniqueCap([...fromContext, ...synthesized], params.maxPaths);
  if (toAdd.length === 0) {
    return seed;
  }

  const paths = uniqueCap([...seedPaths, ...toAdd], params.maxPaths);
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
