import { isSafeRelativePlanningPath, normalizePlanningPath } from "./PlanningPathUtils";

/**
 * Seed-path hygiene for discovery.
 *
 * Preferred paths are assembled from execution seeds, understanding targets,
 * prompt text, retrieved context, and prior conversation. Before any
 * `read_file` is spent on them, drop tokens that are prose rather than paths
 * and resolve basenames / globs against the paths the run already knows.
 */

export const DISCOVERY_SEED_DROP_REASONS = [
  /** Whitespace, URL, abbreviation, framework name, or version-like token. */
  "prose_token",
  /** Bare filename that matches nothing in the known index. */
  "unresolved_basename",
  /** Glob that expands to nothing in the known index (read_file cannot take globs). */
  "unresolved_glob",
  /** Absolute, home-relative, or parent-escaping path. */
  "unsafe_path",
] as const;

export type DiscoverySeedDropReason =
  (typeof DISCOVERY_SEED_DROP_REASONS)[number];

export interface DroppedSeedPath {
  path: string;
  reason: DiscoverySeedDropReason;
}

export interface RewrittenSeedPath {
  from: string;
  to: string[];
}

export interface DiscoverySeedPathResolution {
  kept: string[];
  dropped: DroppedSeedPath[];
  rewritten: RewrittenSeedPath[];
}

/** Framework / product names written like filenames in prose. */
const PROSE_FILE_STEMS = new Set([
  "node",
  "next",
  "nuxt",
  "vue",
  "react",
  "express",
  "three",
  "chart",
  "d3",
  "ember",
  "backbone",
  "socket",
  "asp",
  "mongo",
]);

const PROSE_ABBREVIATION =
  /^(?:e\.g|i\.e|etc|vs|approx|cf|viz|ca|no|fig|sec)\.?$/i;
const VERSION_LIKE = /^v?\d+(?:\.\d+)+(?:[-+][\w.]+)?$/i;
const GLOB_CHARS = /[*?{}[\]]/;
const DEFAULT_MAX_EXPANSION = 3;

/** True when a slash-free token is prose, not a workspace file name. */
export function isProsePathToken(token: string): boolean {
  const value = token.trim();
  if (value.length === 0 || /\s/.test(value) || value.includes("://")) {
    return true;
  }
  if (value.includes("/")) {
    return false;
  }
  if (PROSE_ABBREVIATION.test(value) || VERSION_LIKE.test(value)) {
    return true;
  }
  const dot = value.lastIndexOf(".");
  if (dot <= 0) {
    return false;
  }
  const stem = value.slice(0, dot).toLowerCase();
  const ext = value.slice(dot + 1).toLowerCase();
  return PROSE_FILE_STEMS.has(stem) && ["js", "ts", "io", "net", "css"].includes(ext);
}

function pathKey(path: string): string {
  return normalizePlanningPath(path).toLowerCase();
}

function basenameOf(path: string): string {
  const normalized = normalizePlanningPath(path);
  return normalized.slice(normalized.lastIndexOf("/") + 1).toLowerCase();
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^$()|\\]/g, "\\$&")
    .replace(/\*\*\//g, "(?:.*/)?")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`, "i");
}

/**
 * Validate discovery seed paths.
 *
 * - `knownPaths` is a partial index (retrieved context + candidate paths), so
 *   a full relative path missing from it is kept: absence is not proof.
 * - Bare filenames and globs are resolved against `knownPaths`; unresolved
 *   ones are dropped unless the user named them (`trustedPaths`) or no index
 *   exists.
 */
export function resolveDiscoverySeedPaths(params: {
  paths: readonly string[];
  knownPaths?: readonly string[];
  trustedPaths?: readonly string[];
  maxExpansion?: number;
}): DiscoverySeedPathResolution {
  const knownPaths = (params.knownPaths ?? [])
    .map(normalizePlanningPath)
    .filter((path) => path !== ".");
  const knownByKey = new Map(knownPaths.map((path) => [path.toLowerCase(), path]));
  const trusted = new Set((params.trustedPaths ?? []).map(pathKey));
  const maxExpansion = params.maxExpansion ?? DEFAULT_MAX_EXPANSION;

  const kept: string[] = [];
  const dropped: DroppedSeedPath[] = [];
  const rewritten: RewrittenSeedPath[] = [];
  const seen = new Set<string>();
  const keep = (path: string) => {
    const key = path.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      kept.push(path);
    }
  };

  for (const raw of params.paths) {
    const trimmedRaw = raw.trim();
    if (trimmedRaw.length === 0) {
      continue;
    }
    if (/\s/.test(trimmedRaw) || trimmedRaw.includes("://")) {
      dropped.push({ path: trimmedRaw, reason: "prose_token" });
      continue;
    }
    const path = normalizePlanningPath(trimmedRaw);
    if (!isSafeRelativePlanningPath(path) || path === ".") {
      dropped.push({ path: trimmedRaw, reason: "unsafe_path" });
      continue;
    }
    const key = path.toLowerCase();
    const exact = knownByKey.get(key);
    if (exact) {
      keep(exact);
      continue;
    }
    if (isProsePathToken(path)) {
      dropped.push({ path: trimmedRaw, reason: "prose_token" });
      continue;
    }
    const isTrusted = trusted.has(key);

    if (GLOB_CHARS.test(path)) {
      const matcher = globToRegExp(path);
      const matches = knownPaths.filter((candidate) => matcher.test(candidate));
      if (matches.length === 0) {
        dropped.push({ path: trimmedRaw, reason: "unresolved_glob" });
        continue;
      }
      const chosen = matches.slice(0, maxExpansion);
      rewritten.push({ from: trimmedRaw, to: chosen });
      chosen.forEach(keep);
      continue;
    }

    if (!path.includes("/")) {
      const base = basenameOf(path);
      const matches = knownPaths.filter(
        (candidate) => basenameOf(candidate) === base,
      );
      if (matches.length > 0) {
        const chosen = matches.slice(0, maxExpansion);
        rewritten.push({ from: trimmedRaw, to: chosen });
        // A user-named bare file may live at the root even when the partial
        // index only shows nested namesakes.
        if (isTrusted) keep(path);
        chosen.forEach(keep);
        continue;
      }
      if (knownPaths.length > 0 && !isTrusted) {
        dropped.push({ path: trimmedRaw, reason: "unresolved_basename" });
        continue;
      }
    }
    keep(path);
  }

  return { kept, dropped, rewritten };
}
