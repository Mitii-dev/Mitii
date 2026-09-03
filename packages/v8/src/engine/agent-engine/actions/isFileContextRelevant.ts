import { expandCodeIdentifierTerms } from "../../../modules/repository-state";

const INTERNAL_AGENT_PATH =
  /(^|\/)(?:\.git|\.mitii|\.thunder|node_modules|dist|build|out)(?:\/|$)/i;

/** User is asking about the active selection or "this file". */
export function isExplicitEditorReference(text: string): boolean {
  return /\b(this file|current file|open file|here|selected|selection|above code|below code)\b/i.test(
    text,
  );
}

export function isInternalAgentPath(relPath: string): boolean {
  return INTERNAL_AGENT_PATH.test(relPath.replace(/\\/g, "/"));
}

export interface FileContextRelevanceOptions {
  hasSelection?: boolean;
}

/**
 * Whether a workspace-relative path is relevant to the user message.
 * Adapted from legacy CE `contextRelevance.isFileContextRelevant` — uses
 * path/basename/stem overlap and shared identifier expansion (no parallel
 * file-mention regex).
 */
export function isFileContextRelevant(
  userMessage: string,
  relPath: string,
  options?: FileContextRelevanceOptions,
): boolean {
  if (isInternalAgentPath(relPath)) {
    return false;
  }

  const normalized = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized) {
    return false;
  }

  const message = userMessage.trim();
  if (message.length === 0) {
    return false;
  }

  const base = basename(normalized);
  const stem = stripExtension(base);
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes(normalized.toLowerCase()) ||
    lowerMessage.includes(base.toLowerCase()) ||
    (stem.length >= 3 && lowerMessage.includes(stem.toLowerCase()))
  ) {
    return true;
  }

  for (const term of expandCodeIdentifierTerms(stem)) {
    if (term.length >= 4 && lowerMessage.includes(term)) {
      return true;
    }
  }

  if (options?.hasSelection && isExplicitEditorReference(message)) {
    return true;
  }

  return false;
}

/**
 * Rank score for dirty/diagnostic/@ candidate paths. Higher = prefer earlier
 * in fuzzy candidate lists. Irrelevant / internal paths score 0.
 */
export function scoreFileContextRelevance(
  userMessage: string,
  relPath: string,
  options?: FileContextRelevanceOptions,
): number {
  if (!isFileContextRelevant(userMessage, relPath, options)) {
    return 0;
  }
  if (options?.hasSelection) {
    return 10;
  }
  const normalized = relPath.replace(/\\/g, "/");
  const base = basename(normalized);
  if (userMessage.toLowerCase().includes(normalized.toLowerCase())) {
    return 9;
  }
  if (userMessage.toLowerCase().includes(base.toLowerCase())) {
    return 8;
  }
  return 6;
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function stripExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  if (idx <= 0) {
    return filename;
  }
  return filename.slice(0, idx);
}
