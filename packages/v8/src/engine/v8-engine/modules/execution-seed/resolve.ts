/**
 * Trusted execution seed: authoritative paths/causes before mutate lock.
 * Joins understanding targets + preflight diagnostics; never trusts random retrieval.
 */
import type { RequestUnderstandingResult } from "../../../../modules/request-understanding";
import type { RepoBuildState } from "../../../../modules/verification";

import {
  citedRepoPathsFromPrompt,
  preflightDiagnosticsForUserRequest,
} from "../user-path-priority";

export const EXECUTION_SEED_MAX_PATHS = 8;
export const EXECUTION_SEED_MAX_SYMBOLS = 8;
export const EXECUTION_SEED_MAX_CAUSE_NOTES = 6;

export type ExecutionSeedConfidence = "trusted" | "weak";
export type ExecutionSeedSource =
  | "user"
  | "diagnostic"
  | "artifact"
  | "mixed"
  | "none";

export type ExecutionSeed = {
  paths: string[];
  symbols: string[];
  causeNotes: string[];
  confidence: ExecutionSeedConfidence;
  source: ExecutionSeedSource;
};

export type ExecutionSeedDiagnostic = {
  path: string;
  code?: string;
  message: string;
  severity?: string;
};

const FIX_BUILD_ASK =
  /\b(?:fix\s+(?:all\s+)?(?:ts|typescript|type\s*check|typecheck|build|compile)|resolve\s+(?:all\s+)?(?:ts|typescript)\s+errors|type\s*errors?\b)/i;

/**
 * Resolve the authoritative seed for execute/write binding and mutate lock.
 */
export function resolveExecutionSeed(params: {
  userPrompt?: string;
  understanding?: RequestUnderstandingResult;
  repoBuildStateBefore?: RepoBuildState;
  /** Optional capped diagnostic hint already built for understanding. */
  diagnosticSummary?: {
    diagnostics?: readonly ExecutionSeedDiagnostic[];
  };
}): ExecutionSeed {
  const prompt = params.userPrompt?.trim() ?? "";
  const userPaths: string[] = [];
  const artifactPaths: string[] = [];
  const symbols: string[] = [];

  for (const target of params.understanding?.taskAnalysis.targets ?? []) {
    const value = normalizePath(target.value);
    if (!value) continue;
    if (target.kind === "symbol") {
      pushUnique(symbols, value, EXECUTION_SEED_MAX_SYMBOLS);
      continue;
    }
    if (target.kind !== "file" && target.kind !== "folder") {
      continue;
    }
    if (target.explicit) {
      pushUnique(userPaths, value, EXECUTION_SEED_MAX_PATHS);
    } else {
      pushUnique(artifactPaths, value, EXECUTION_SEED_MAX_PATHS);
    }
  }

  for (const cited of citedRepoPathsFromPrompt(prompt)) {
    pushUnique(userPaths, cited, EXECUTION_SEED_MAX_PATHS);
  }

  const rawDiagnostics = collectDiagnostics(
    params.repoBuildStateBefore,
    params.diagnosticSummary?.diagnostics,
  );
  const scopedDiagnostics = preflightDiagnosticsForUserRequest(
    rawDiagnostics,
    prompt || undefined,
  );
  const diagnosticPaths: string[] = [];
  const causeNotes: string[] = [];
  for (const diagnostic of scopedDiagnostics) {
    const path = normalizePath(diagnostic.path);
    if (path) {
      pushUnique(diagnosticPaths, path, EXECUTION_SEED_MAX_PATHS);
    }
    const note = formatCauseNote(diagnostic);
    if (note) {
      pushUnique(causeNotes, note, EXECUTION_SEED_MAX_CAUSE_NOTES);
    }
  }

  const hasUser = userPaths.length > 0;
  const hasArtifact = artifactPaths.length > 0 && !hasUser;
  const fixBuildAsk = FIX_BUILD_ASK.test(prompt);
  const citedInPrompt = citedRepoPathsFromPrompt(prompt).length > 0;
  const trustDiagnostics =
    diagnosticPaths.length > 0 &&
    (fixBuildAsk || !citedInPrompt || hasOverlap(userPaths, diagnosticPaths));

  if (hasUser && trustDiagnostics) {
    return {
      paths: uniqueCap(
        [...userPaths, ...diagnosticPaths],
        EXECUTION_SEED_MAX_PATHS,
      ),
      symbols,
      causeNotes,
      confidence: "trusted",
      source: "mixed",
    };
  }
  if (hasUser) {
    return {
      paths: userPaths.slice(0, EXECUTION_SEED_MAX_PATHS),
      symbols,
      causeNotes,
      confidence: "trusted",
      source: "user",
    };
  }
  if (hasArtifact) {
    return {
      paths: artifactPaths.slice(0, EXECUTION_SEED_MAX_PATHS),
      symbols,
      causeNotes,
      confidence: "trusted",
      source: "artifact",
    };
  }
  if (trustDiagnostics) {
    return {
      paths: diagnosticPaths.slice(0, EXECUTION_SEED_MAX_PATHS),
      symbols,
      causeNotes,
      confidence: "trusted",
      source: "diagnostic",
    };
  }
  if (diagnosticPaths.length > 0 || symbols.length > 0) {
    return {
      paths: diagnosticPaths.slice(0, EXECUTION_SEED_MAX_PATHS),
      symbols,
      causeNotes,
      confidence: "weak",
      source: diagnosticPaths.length > 0 ? "diagnostic" : "none",
    };
  }
  return {
    paths: [],
    symbols: [],
    causeNotes: [],
    confidence: "weak",
    source: "none",
  };
}

export function isExecutionSeedTrusted(seed: ExecutionSeed | undefined): boolean {
  return seed?.confidence === "trusted" && (seed.paths.length > 0 || seed.symbols.length > 0);
}

/** Compact prompt block for execute/write binding. Empty when seed is none/empty. */
export function formatExecutionSeedForPrompt(seed: ExecutionSeed | undefined): string {
  if (!seed || seed.source === "none" || (seed.paths.length === 0 && seed.causeNotes.length === 0)) {
    return "";
  }
  const lines = [
    `ExecutionSeed confidence=${seed.confidence} source=${seed.source}`,
  ];
  if (seed.paths.length > 0) {
    lines.push(`paths: ${seed.paths.join(", ")}`);
  }
  if (seed.symbols.length > 0) {
    lines.push(`symbols: ${seed.symbols.join(", ")}`);
  }
  if (seed.causeNotes.length > 0) {
    lines.push("cause:");
    for (const note of seed.causeNotes.slice(0, 4)) {
      lines.push(`- ${note}`);
    }
  }
  if (seed.confidence === "trusted") {
    lines.push(
      "Binding: read only these write/mustRead paths (and hop-1 mustRead). No broad search while binding. apply_patch only when READY.",
    );
  } else {
    lines.push(
      "Seed is weak — do not apply_patch until a trusted path is established from diagnostics or an explicit file.",
    );
  }
  return lines.join("\n");
}

function collectDiagnostics(
  state: RepoBuildState | undefined,
  summaryDiagnostics: readonly ExecutionSeedDiagnostic[] | undefined,
): ExecutionSeedDiagnostic[] {
  if (summaryDiagnostics && summaryDiagnostics.length > 0) {
    return summaryDiagnostics.map((item) => ({
      path: item.path,
      code: item.code,
      message: item.message,
      severity: item.severity,
    }));
  }
  if (!state) return [];
  return state.diagnostics
    .filter((item) => item.severity === "error")
    .slice(0, 24)
    .map((item) => ({
      path: item.path,
      code: item.code,
      message: item.message,
      severity: item.severity,
    }));
}

function formatCauseNote(diagnostic: ExecutionSeedDiagnostic): string {
  const path = normalizePath(diagnostic.path) || diagnostic.path;
  const code = diagnostic.code?.trim();
  const message = diagnostic.message.trim().slice(0, 180);
  if (!path && !message) return "";
  return [path, code, message].filter(Boolean).join(": ");
}

function hasOverlap(left: readonly string[], right: readonly string[]): boolean {
  const rightSet = new Set(right.map((path) => path.toLowerCase()));
  return left.some((path) => rightSet.has(path.toLowerCase()));
}

function pushUnique(list: string[], value: string, max: number): void {
  const normalized = normalizePath(value);
  if (!normalized) return;
  if (list.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
    return;
  }
  if (list.length >= max) return;
  list.push(normalized);
}

function uniqueCap(values: readonly string[], max: number): string[] {
  const out: string[] = [];
  for (const value of values) {
    pushUnique(out, value, max);
  }
  return out;
}

function normalizePath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}
