import type { RequestUnderstandingResult } from "../../request-understanding";

function normalizeScopePath(value: string): string {
  let normalized =
    value.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+$/, "") || ".";
  // Same CI rewrite as tool-runtime: never grant a parallel `github/` tree.
  if (/^github\//i.test(normalized) || normalized === "github") {
    normalized =
      normalized === "github"
        ? ".github"
        : `.github/${normalized.slice("github/".length)}`;
  }
  return normalized;
}

function parentDirectoryScope(filePath: string): string {
  const normalized = normalizeScopePath(filePath);
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

export function resolvePathScopes(
  understanding: RequestUnderstandingResult,
): string[] {
  const primaryIntent =
    understanding.intent.classification.primaryTaskIntent;
  if (
    primaryIntent === "dependency" ||
    primaryIntent === "security" ||
    primaryIntent === "audit"
  ) {
    return ["."];
  }

  const { taskAnalysis } = understanding;

  // Discovery-heavy / wide scope: keep workspace-wide read access.
  // Pinned folders are focus hints only — they do not fence workspace reads.
  if (
    taskAnalysis.recommendsRepositoryDiscovery ||
    taskAnalysis.scope === "repository" ||
    taskAnalysis.scope === "workspace" ||
    taskAnalysis.scope === "package" ||
    taskAnalysis.scope === "multi_file" ||
    taskAnalysis.scope === "unknown"
  ) {
    return ["."];
  }

  // Localized work: only *explicit* folder/file mentions narrow read scopes.
  // Implicit artifact / UI pins stay workspace-wide so the agent can still
  // read elsewhere in the workspace (and ask before leaving it).
  const scopes = new Set<string>();
  for (const target of taskAnalysis.targets) {
    if (!target.explicit || target.value.length === 0) {
      continue;
    }
    if (target.kind === "folder") {
      scopes.add(normalizeScopePath(target.value));
      continue;
    }
    if (target.kind === "file") {
      scopes.add(parentDirectoryScope(target.value));
    }
  }

  if (scopes.size === 0) {
    return ["."];
  }

  return [...scopes];
}

export function resolveMutationPathScopes(
  understanding: RequestUnderstandingResult,
  message?: string,
): string[] | undefined {
  const scopes = new Set<string>();
  for (const target of understanding.taskAnalysis.targets) {
    if (target.value.length === 0) {
      continue;
    }
    // Explicit folder/file mentions only. Implicit UI pins are focus, not a
    // hard mutation fence — workspace remains the default write ceiling.
    if (!target.explicit) {
      continue;
    }
    if (target.kind === "folder") {
      scopes.add(normalizeScopePath(target.value));
      continue;
    }
    if (target.kind === "file") {
      scopes.add(parentDirectoryScope(target.value));
    }
  }
  if (message && looksLikeWorkspaceRootMutation(message)) {
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
