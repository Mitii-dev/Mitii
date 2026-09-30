import type { DiagnosticSummary } from "../../../modules/request-understanding";
import type { RequestArtifactReference } from "../../../modules/request-intake";

import {
  isInternalAgentPath,
  scoreFileContextRelevance,
} from "./isFileContextRelevant";

/**
 * Collect cheap candidate relative paths for fuzzy file-target resolution
 * after repository context retrieval (dirty files, diagnostic paths, @refs).
 * Callers must not feed this sparse list into early understand() alone —
 * unique basename hits can lock the wrong file before richer repo-map paths
 * exist.
 *
 * When `userMessage` is set, internal agent paths are dropped and
 * message-relevant paths are sorted first (legacy CE contextRelevance).
 */
export function collectUnderstandingCandidatePaths(params: {
  dirtyPaths?: readonly string[] | undefined;
  diagnosticSummary?: DiagnosticSummary | undefined;
  referencedArtifacts?: readonly RequestArtifactReference[] | undefined;
  userMessage?: string | undefined;
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (raw: string | undefined) => {
    if (!raw) return;
    const normalized = raw.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    if (
      !normalized ||
      normalized.startsWith("/") ||
      normalized.startsWith("~") ||
      /^[A-Za-z]:\//.test(normalized) ||
      isInternalAgentPath(normalized)
    ) {
      return;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(normalized);
  };

  for (const path of params.dirtyPaths ?? []) {
    push(path);
  }
  for (const entry of params.diagnosticSummary?.diagnostics ?? []) {
    push(entry.path);
  }
  for (const artifact of params.referencedArtifacts ?? []) {
    push(artifact.path);
  }

  const message = params.userMessage?.trim();
  if (!message || out.length <= 1) {
    return out;
  }

  return [...out].sort((left, right) => {
    const scoreDelta =
      scoreFileContextRelevance(message, right) -
      scoreFileContextRelevance(message, left);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return left.localeCompare(right);
  });
}
