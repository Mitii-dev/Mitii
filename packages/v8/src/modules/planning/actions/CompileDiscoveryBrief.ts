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

  const proposedChangeSurfaces = inferChangeSurfaces(filesRead, searchFiles);
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

function inferChangeSurfaces(
  filesRead: readonly DiscoveryFileRef[],
  searchFiles: readonly { path: string; reason: string }[],
): DiscoveryChangeSurface[] {
  const candidates = uniqueByPath([
    ...filesRead.map((file) => ({ path: file.path, reason: file.reason })),
    ...searchFiles,
  ]).filter(
    (item) =>
      FILE_LIKE.test(item.path) &&
      !TEST_LIKE.test(item.path) &&
      !CONFIG_LIKE.test(item.path),
  );

  return candidates.slice(0, 16).map((item) => ({
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
  const sourceReads = params.filesRead.filter(
    (file) => !CONFIG_LIKE.test(file.path) && !TEST_LIKE.test(file.path),
  ).length;
  // Config/test reads never count as change surfaces. High confidence
  // requires at least one real source surface plus a source file read.
  if (params.surfaces.length >= 2 && sourceReads >= 2) {
    return "high";
  }
  if (params.surfaces.length >= 1 && sourceReads >= 1) {
    return "medium";
  }
  if (params.targets.some((target) => target.explicit && FILE_LIKE.test(target.value))) {
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
