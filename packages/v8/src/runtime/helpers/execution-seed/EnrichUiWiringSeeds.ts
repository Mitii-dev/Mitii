/**
 * Bind composition wiring (App.tsx) for Index/settings navigation asks.
 */
import type { ExecutionSeed } from "./ResolveExecutionSeed";
import {
  normalize,
  samePathSet,
  uniqueCap,
} from "./RefineFromContextHelpers";

const UI_NAV_ASK =
  /\b(?:click(?:ing)?|redirect|open|navigat\w*|tab)\b/i;
const CHIP_OR_SETTINGS =
  /(?:IndexStatusChip|SettingsPanel)\.[A-Za-z0-9]+$/i;
const RENDERER_APP = /\/(?:renderer\/)?App\.(tsx|jsx|ts|js)$/i;

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
