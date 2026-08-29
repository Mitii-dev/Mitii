import { PLANNING_SCHEMA_VERSION } from "../constants";
import {
  discoveryBriefSchema,
  discoveryObservationSchema,
} from "../contracts";
import type {
  DiscoveryBrief,
  DiscoveryChangeSurface,
  DiscoveryFileRef,
  DiscoveryObservation,
  DiscoveryTarget,
  DiscoveryVerificationHint,
} from "../contracts";

const FILE_LIKE = /\.\w{1,16}$/;
const TEST_LIKE = /(?:\.test|\.spec|\/tests?\/|\/__tests__\/)/i;
const CONFIG_LIKE = /(?:^|\/)(?:.*\.)?(?:config|rc|toml|ya?ml|json|env)(?:$|\.)/i;
/** Lockfiles / tooling noise — never promote to change surfaces from listing. */
const NOISE_CONFIG =
  /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|composer\.lock|Cargo\.lock|\.mitii\/)/i;
/** Package/tsconfig manifests — only surfaces when explicitly targeted. */
const MANIFEST_CONFIG =
  /(?:^|\/)(?:package\.json|tsconfig[\w.-]*\.json)$/i;

/**
 * Compile host-neutral discovery observations into a durable DiscoveryBrief.
 * Deterministic: does not invent change surfaces without observed files.
 */
export function compileDiscoveryBrief(
  input: DiscoveryObservation,
): DiscoveryBrief {
  const parsed = discoveryObservationSchema.parse(input);
  const filesRead = uniqueFiles(parsed.filesRead);
  const searchFiles = uniqueByPath(
    parsed.searchHits.map((hit) => ({
      path: normalizePath(hit.path),
      reason: hit.reason,
    })),
  );

  const targets = uniqueTargets([
    ...parsed.explicitTargets.map((target) => ({
      ...target,
      value: normalizePath(target.value),
    })),
    ...filesRead.map((file) => ({
      kind: inferTargetKind(file.path),
      value: file.path,
      reason: file.reason,
      explicit: false,
    })),
    ...searchFiles.map((hit) => ({
      kind: inferTargetKind(hit.path),
      value: hit.path,
      reason: hit.reason,
      explicit: false,
    })),
  ]);

  const proposedChangeSurfaces = inferChangeSurfaces({
    filesRead,
    searchFiles,
    explicitTargets: parsed.explicitTargets,
  });
  const verificationHints = uniqueHints([
    ...parsed.verificationHints,
    ...inferVerificationHints(filesRead),
  ]);
  const openQuestions = inferOpenQuestions({
    filesRead,
    surfaces: proposedChangeSurfaces,
    notes: parsed.notes,
  });
  const confidence = inferConfidence({
    filesRead,
    surfaces: proposedChangeSurfaces,
    targets,
  });

  return discoveryBriefSchema.parse({
    schemaVersion: PLANNING_SCHEMA_VERSION,
    objective: parsed.objective.trim().slice(0, 1_000),
    filesRead,
    targets,
    proposedChangeSurfaces,
    discoveredConstraints: uniqueStrings(parsed.constraints).slice(0, 20),
    verificationHints,
    openQuestions,
    confidence,
  });
}

function inferChangeSurfaces(params: {
  filesRead: readonly DiscoveryFileRef[];
  searchFiles: readonly { path: string; reason: string }[];
  explicitTargets: readonly DiscoveryTarget[];
}): DiscoveryChangeSurface[] {
  const explicitPaths = new Set(
    params.explicitTargets
      .filter(
        (target) =>
          target.kind === "file" ||
          target.kind === "config" ||
          target.kind === "test" ||
          FILE_LIKE.test(target.value),
      )
      .map((target) => normalizePath(target.value))
      .filter(Boolean),
  );
  const readPaths = new Set(params.filesRead.map((file) => file.path));

  const ranked = uniqueByPath([
    ...params.filesRead.map((file) => ({
      path: file.path,
      reason: file.reason,
      fromRead: true,
    })),
    ...params.searchFiles.map((hit) => ({
      path: hit.path,
      reason: hit.reason,
      fromRead: false,
    })),
  ]).filter((item) => {
    if (!FILE_LIKE.test(item.path) || TEST_LIKE.test(item.path)) {
      return false;
    }
    if (NOISE_CONFIG.test(item.path)) {
      return false;
    }
    const isConfig = CONFIG_LIKE.test(item.path);
    if (!isConfig) {
      return true;
    }
    // Manifests (package.json / tsconfig) are not edit surfaces unless targeted.
    if (MANIFEST_CONFIG.test(item.path) && !explicitPaths.has(item.path)) {
      return false;
    }
    // Other config modules are first-class when read or explicitly targeted
    // (e.g. test/shared/config/testConfig.ts).
    if (item.fromRead || explicitPaths.has(item.path)) {
      return true;
    }
    return /(?:^|\/)[\w.-]*config[\w.-]*\.\w{1,16}$/i.test(item.path);
  });

  // Prefer actually-read paths, then explicit, then search hits.
  ranked.sort((left, right) => {
    const leftScore =
      (readPaths.has(left.path) ? 4 : 0) +
      (explicitPaths.has(left.path) ? 2 : 0) +
      (left.fromRead ? 1 : 0);
    const rightScore =
      (readPaths.has(right.path) ? 4 : 0) +
      (explicitPaths.has(right.path) ? 2 : 0) +
      (right.fromRead ? 1 : 0);
    return rightScore - leftScore;
  });

  return ranked.slice(0, 16).map((item) => ({
    path: item.path,
    actionHint: "Change",
    riskLevel: "low",
    evidence: item.reason,
  }));
}

function inferVerificationHints(
  filesRead: readonly DiscoveryFileRef[],
): DiscoveryVerificationHint[] {
  const hints: DiscoveryVerificationHint[] = [];
  if (filesRead.some((file) => TEST_LIKE.test(file.path))) {
    hints.push({
      kind: "test",
      reason: "Discovery read at least one nearby test file.",
    });
  }
  if (filesRead.some((file) => /\.(?:ts|tsx|js|jsx)$/.test(file.path))) {
    hints.push({
      kind: "typecheck",
      reason: "Typed source files were reviewed.",
    });
  }
  return hints;
}

function inferOpenQuestions(params: {
  filesRead: readonly DiscoveryFileRef[];
  surfaces: readonly DiscoveryChangeSurface[];
  notes: readonly string[];
}): string[] {
  const questions: string[] = [];
  if (params.filesRead.length === 0) {
    questions.push(
      "Which concrete files or symbols should change for this request?",
    );
  }
  if (params.surfaces.length === 0) {
    questions.push(
      "What is the smallest change surface, and which existing tests prove it?",
    );
  }
  for (const note of params.notes) {
    if (/\?$/.test(note.trim())) {
      questions.push(note.trim());
    }
  }
  return uniqueStrings(questions).slice(0, 12);
}

function inferConfidence(params: {
  filesRead: readonly DiscoveryFileRef[];
  surfaces: readonly DiscoveryChangeSurface[];
  targets: readonly DiscoveryTarget[];
}): DiscoveryBrief["confidence"] {
  const productiveReads = params.filesRead.filter(
    (file) => !NOISE_CONFIG.test(file.path) && !TEST_LIKE.test(file.path),
  ).length;
  // Config reads count when they produced a change surface (config features).
  if (params.surfaces.length >= 2 && productiveReads >= 2) {
    return "high";
  }
  if (params.surfaces.length >= 1 && productiveReads >= 1) {
    return "medium";
  }
  if (
    params.targets.some(
      (target) => target.explicit && FILE_LIKE.test(target.value),
    )
  ) {
    return "medium";
  }
  return "low";
}

function inferTargetKind(path: string): DiscoveryTarget["kind"] {
  if (TEST_LIKE.test(path)) return "test";
  if (CONFIG_LIKE.test(path)) return "config";
  if (FILE_LIKE.test(path)) return "file";
  if (path.includes("/") && !FILE_LIKE.test(path)) return "folder";
  return "unknown";
}

function uniqueFiles(files: readonly DiscoveryFileRef[]): DiscoveryFileRef[] {
  const seen = new Set<string>();
  const result: DiscoveryFileRef[] = [];
  for (const file of files) {
    const path = normalizePath(file.path);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    result.push({
      path,
      reason: file.reason,
      ...(file.symbols && file.symbols.length > 0
        ? { symbols: uniqueStrings(file.symbols).slice(0, 16) }
        : {}),
    });
    if (result.length >= 40) break;
  }
  return result;
}

function uniqueTargets(targets: readonly DiscoveryTarget[]): DiscoveryTarget[] {
  const seen = new Set<string>();
  const result: DiscoveryTarget[] = [];
  for (const target of targets) {
    const value = normalizePath(target.value);
    const key = `${target.kind}:${value}`;
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push({ ...target, value });
    if (result.length >= 32) break;
  }
  return result;
}

function uniqueHints(
  hints: readonly DiscoveryVerificationHint[],
): DiscoveryVerificationHint[] {
  const seen = new Set<string>();
  const result: DiscoveryVerificationHint[] = [];
  for (const hint of hints) {
    const key = `${hint.kind}:${hint.command ?? ""}:${hint.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(hint);
    if (result.length >= 16) break;
  }
  return result;
}

function uniqueByPath<T extends { path: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const path = normalizePath(item.path);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    result.push({ ...item, path });
  }
  return result;
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}
