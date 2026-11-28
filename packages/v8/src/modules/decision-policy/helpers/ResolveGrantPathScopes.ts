import type { RequestUnderstandingResult } from "../../request-understanding";
import {
  extractExplicitMutationFence,
} from "./ExtractExplicitMutationFence";

function normalizeScopePath(value: string): string {
  let normalized =
    value.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+$/, "") || ".";
  if (/^github\//i.test(normalized) || normalized === "github") {
    normalized =
      normalized === "github"
        ? ".github"
        : `.github/${normalized.slice("github/".length)}`;
  }
  return normalized;
}

export interface MutationScopeOptions {
  /** From SituationPack.scope — preferred when present (S2-SCOPE). */
  scopeVerdict?: {
    mutationFence?: readonly string[];
    focusPaths?: readonly string[];
    protectedPaths?: readonly string[];
  };
}

/** Protected paths from ScopeVerdict (hard caution; dual-write to grant). */
export function resolveProtectedPathGlobs(
  options?: MutationScopeOptions,
): string[] | undefined {
  const protectedPaths = options?.scopeVerdict?.protectedPaths;
  if (!protectedPaths || protectedPaths.length === 0) {
    return undefined;
  }
  return [...new Set(protectedPaths.map(normalizeScopePath))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/**
 * Read scopes stay workspace-wide. Mentions are focus, not a pathScopes prison.
 */
export function resolvePathScopes(
  _understanding: RequestUnderstandingResult,
): string[] {
  return ["."];
}

/**
 * Mutation fence: ScopeVerdict.mutationFence → explicit prose → root create.
 * Folder/file @-mentions alone never set mutationPathScopes.
 */
export function resolveMutationPathScopes(
  understanding: RequestUnderstandingResult,
  message?: string,
  options?: MutationScopeOptions,
): string[] | undefined {
  const verdictFence = options?.scopeVerdict?.mutationFence;
  if (verdictFence && verdictFence.length > 0) {
    return [...new Set(verdictFence.map(normalizeScopePath))].sort((a, b) =>
      a.localeCompare(b),
    );
  }

  const text = message ?? "";
  const focusFromTargets = understanding.taskAnalysis.targets
    .filter((t) => t.explicit && t.value.length > 0)
    .filter((t) => t.kind === "folder" || t.kind === "file")
    .map((t) => normalizeScopePath(t.value));

  const focusFromVerdict = (options?.scopeVerdict?.focusPaths ?? []).map(
    normalizeScopePath,
  );

  const fence = extractExplicitMutationFence(text, [
    ...focusFromTargets,
    ...focusFromVerdict,
  ]);
  const scopes = new Set<string>(fence ?? []);

  if (text.length > 0 && looksLikeWorkspaceRootMutation(text)) {
    scopes.add(".");
  }

  if (scopes.size === 0) {
    return undefined;
  }
  return [...scopes].sort((left, right) => left.localeCompare(right));
}

/** User asked to create or edit at the repository/workspace root. */
export function looksLikeWorkspaceRootMutation(message: string): boolean {
  return (
    /\b(?:in|at|to)\s+(?:the\s+)?(?:project|repo(?:sitory)?|workspace)\s+root\b/i.test(
      message,
    ) ||
    /\b(?:project|repo(?:sitory)?|workspace)\s+root\b/i.test(message) ||
    /\broot\s+of\s+(?:the\s+)?(?:project|repo(?:sitory)?|workspace)\b/i.test(
      message,
    )
  );
}
