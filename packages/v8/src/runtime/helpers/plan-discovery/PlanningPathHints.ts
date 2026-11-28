import {
  isSafeRelativePlanningPath,
  normalizePlanningPath,
  uniqueStrings,
} from "./PlanningPathUtils";
import { isProsePathToken } from "./DiscoverySeedPaths";
import {
  rankPathsForShapedDiscovery,
  resolveShapedDiscoveryProfile,
} from "../shaped-discovery";
import { isPlanningFollowUp } from "./IsPlanningFollowUp";
import { looksLikeMultiItemPlanGuidance } from "./PlanningQuery";

const FILE_LIKE_PATH =
  /(?:^|[\s`"'(=,[])((?:[\w.-]+\/)+[\w.-]+\.[\w]{1,16})\b/g;
const MAX_PRIOR_PATH_HINTS = 8;
/** Follow-up Plan asks keep more prior-touched paths for discovery seeds. */
const MAX_PRIOR_PATH_HINTS_FOLLOW_UP = 16;

export type PlanningTaskSize = "small" | "medium" | "large";

/**
 * Follow-up Plan asks that target a multi-item prior answer must not stay
 * `small` / single-location — bump at least to medium so discovery budgets
 * and search floors unlock.
 */
export function resolveFollowUpPlanningTaskSize(params: {
  currentTaskSize?: PlanningTaskSize | string;
  currentQuery: string;
  conversation: readonly { role: string; content: string }[];
  planningQuery?: string;
}): PlanningTaskSize {
  const current =
    params.currentTaskSize === "medium" || params.currentTaskSize === "large"
      ? params.currentTaskSize
      : "small";
  if (current !== "small") {
    return current;
  }
  if (!isPlanningFollowUp(params.currentQuery, params.conversation)) {
    return "small";
  }
  const priorAssistant = [...params.conversation]
    .reverse()
    .find(
      (entry) =>
        entry.role === "assistant" && entry.content.trim().length >= 40,
    )
    ?.content;
  const grounding = [params.planningQuery, priorAssistant]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join("\n\n");
  if (looksLikeMultiItemPlanGuidance(grounding)) {
    return "medium";
  }
  return "small";
}

/**
 * File-like paths mentioned in prior turns (user/assistant/tool) and tool-call
 * arguments. Used to seed discovery and context — hints only, not grants.
 */
export function extractPriorPathHints(
  conversation: readonly {
    role: string;
    content: string;
    toolCalls?: readonly { name: string; arguments: string }[];
  }[],
  options?: { max?: number },
): string[] {
  const max = options?.max ?? MAX_PRIOR_PATH_HINTS;
  const recent = conversation
    .filter(
      (entry) =>
        (entry.role === "user" ||
          entry.role === "assistant" ||
          entry.role === "tool") &&
        (entry.content.trim().length > 0 ||
          (entry.toolCalls?.length ?? 0) > 0),
    )
    .slice(-12);
  const found: string[] = [];
  for (const entry of recent) {
    if (entry.content.trim().length > 0) {
      for (const path of extractFileLikePaths(entry.content)) {
        found.push(path);
      }
    }
    for (const call of entry.toolCalls ?? []) {
      for (const path of extractPathsFromToolArguments(call.arguments)) {
        found.push(path);
      }
    }
  }
  return uniqueStrings(found.map(normalizePlanningPath))
    .filter((path) => isSafeRelativePlanningPath(path) && path.includes("."))
    .slice(0, max);
}

/**
 * Prefer a larger prior-path budget for Plan follow-ups so Ask-touched files
 * survive into discovery seeds when live context retrieval collapses.
 */
export function resolvePriorPathHintBudget(params: {
  currentQuery: string;
  conversation: readonly { role: string; content: string }[];
  mode?: "ask" | "plan" | "agent";
}): number {
  if (
    params.mode === "plan" ||
    isPlanningFollowUp(params.currentQuery, params.conversation)
  ) {
    return MAX_PRIOR_PATH_HINTS_FOLLOW_UP;
  }
  return MAX_PRIOR_PATH_HINTS;
}

/**
 * Union retrieved context paths with prior-turn path hints. When retrieval
 * collapses to a single file but the prior Ask touched more, keep the richer
 * set for planning / discovery seeding.
 */
export function mergeContextPathsWithPriorHints(params: {
  contextPaths: readonly string[];
  priorPathHints: readonly string[];
  max?: number;
}): string[] {
  const max = params.max ?? MAX_PRIOR_PATH_HINTS_FOLLOW_UP;
  const context = params.contextPaths
    .map(normalizePlanningPath)
    .filter((path) => isSafeRelativePlanningPath(path) && path !== ".");
  const prior = params.priorPathHints
    .map(normalizePlanningPath)
    .filter(
      (path) =>
        isSafeRelativePlanningPath(path) &&
        path !== "." &&
        path.includes("."),
    );
  if (prior.length === 0) {
    return uniqueStrings(context).slice(0, max);
  }
  // Prefer prior-touched files first (Ask grounding), then fresh retrieval.
  return uniqueStrings([...prior, ...context]).slice(0, max);
}

/**
 * Preferred discovery / strategy paths: seed paths, explicit file targets,
 * context paths, then prior conversation path hints.
 */
export function collectPreferredPlanningPaths(params: {
  evidenceTargets?: readonly { kind: string; value: string; explicit: boolean }[];
  contextPaths?: readonly string[];
  priorPathHints?: readonly string[];
  /** Trusted execution-seed paths (authoritative; ranked first). */
  seedPaths?: readonly string[];
  query?: string;
  max?: number;
}): string[] {
  const max = params.max ?? MAX_PRIOR_PATH_HINTS;
  const seed = (params.seedPaths ?? []).map(normalizePlanningPath);
  const explicit = (params.evidenceTargets ?? [])
    .filter(
      (target) =>
        target.explicit &&
        (target.kind === "file" ||
          target.kind === "config" ||
          target.kind === "test" ||
          /\.\w{1,16}$/.test(target.value)),
    )
    .map((target) => normalizePlanningPath(target.value));
  const context = (params.contextPaths ?? []).map(normalizePlanningPath);
  const prior = (params.priorPathHints ?? []).map(normalizePlanningPath);
  // Prompt-named paths (e.g. packages/shared/src/index.js) must seed discovery
  // even when task analysis did not emit explicit file targets.
  const fromQuery = params.query
    ? extractFileLikePaths(params.query).map(normalizePlanningPath)
    : [];
  const merged = uniqueStrings([
    ...seed,
    ...explicit,
    ...fromQuery,
    ...context,
    ...prior,
  ]).filter(
    (path) =>
      isSafeRelativePlanningPath(path) &&
      path !== "." &&
      !isProsePathToken(path) &&
      (path.includes(".") || path.includes("/")),
  );
  const profile = params.query
    ? resolveShapedDiscoveryProfile(params.query)
    : undefined;
  const ranked = profile
    ? rankPathsForShapedDiscovery(profile, merged)
    : merged;
  // Keep seed paths first even after shaped ranking.
  const seedSet = new Set(seed.map((path) => path.toLowerCase()));
  const ordered = [
    ...merged.filter((path) => seedSet.has(path.toLowerCase())),
    ...ranked.filter((path) => !seedSet.has(path.toLowerCase())),
  ];
  return uniqueStrings(ordered).slice(0, max);
}

/**
 * Paths the user (or a trusted execution seed) named directly. These may not
 * exist in the index yet (create asks), so seed-path hygiene never drops them
 * as unindexed.
 */
export function collectTrustedSeedPaths(params: {
  seedPaths?: readonly string[];
  evidenceTargets?: readonly { kind: string; value: string; explicit: boolean }[];
  query?: string;
}): string[] {
  const explicit = (params.evidenceTargets ?? [])
    .filter((target) => target.explicit && /\.\w{1,16}$/.test(target.value))
    .map((target) => target.value);
  const fromQuery = params.query ? extractFileLikePaths(params.query) : [];
  return uniqueStrings(
    [...(params.seedPaths ?? []), ...explicit, ...fromQuery]
      .map(normalizePlanningPath)
      .filter((path) => path !== "." && !isProsePathToken(path)),
  );
}

export function extractFileLikePaths(text: string): string[] {
  const paths: string[] = [];
  const re = new RegExp(FILE_LIKE_PATH.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const path = match[1]?.trim();
    if (path) paths.push(path);
  }
  // Bare or nested paths in backticks / code spans.
  const backtick = /`((?:[\w.@/-]+\/)*[\w.-]+\.[\w]{1,16})`/g;
  while ((match = backtick.exec(text)) !== null) {
    const path = match[1]?.trim();
    if (path) paths.push(path);
  }
  // Plain-text filenames / relative paths with common source extensions.
  const plain =
    /\b((?:[\w.-]+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|json|ya?ml|toml|md|css|scss))\b/gi;
  while ((match = plain.exec(text)) !== null) {
    const path = match[1]?.trim();
    if (path) paths.push(path);
  }
  return paths;
}

/** Pull path / paths fields from tool-call JSON arguments. */
function extractPathsFromToolArguments(argumentsJson: string): string[] {
  const trimmed = argumentsJson.trim();
  if (!trimmed || trimmed === "{}") {
    return [];
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const found: string[] = [];
    const pathValue = parsed.path;
    if (typeof pathValue === "string" && pathValue.trim()) {
      found.push(pathValue.trim());
    }
    const pathsValue = parsed.paths;
    if (Array.isArray(pathsValue)) {
      for (const entry of pathsValue) {
        if (typeof entry === "string" && entry.trim()) {
          found.push(entry.trim());
        }
      }
    }
    // Fallback: path-like strings embedded in the arguments blob.
    if (found.length === 0) {
      found.push(...extractFileLikePaths(trimmed));
    }
    return found;
  } catch {
    return extractFileLikePaths(trimmed);
  }
}
