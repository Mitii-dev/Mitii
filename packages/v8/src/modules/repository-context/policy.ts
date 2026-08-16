import {
  WINDOW_BUDGET_SCHEMA_VERSION,
  deriveWindowPolicy,
} from "../window-budget";
import {
  CONTEXT_SELECTION_DEFAULTS,
  CONTEXT_SELECTION_LIMITS,
} from "./internal/context-selection/constants";
import type {
  ContextFileReference,
  ContextSelectionBudget,
  ContextSelectionReferences,
} from "./internal/context-selection/types";

/**
 * Public selection-budget policy for callers (Agent Engine) that scale
 * repository context selection with the active model context window.
 */
export const REPOSITORY_CONTEXT_BUDGET_POLICY = {
  /** Fraction of model context window used for repository selection tokens. */
  selectionBudgetContextWindowRatio: 0.25,
} as const;

export const REPOSITORY_CONTEXT_RETRIEVAL_POLICY = {
  /** Cap on editor/git file priors used as RepoGraph blast-radius anchors. */
  maximumGraphFileAnchors: 16,
} as const;

/**
 * Collect open / current / git-dirty paths as graph retrieval anchors.
 * These seed blast-radius expansion and must not be used as `filePaths` filters.
 */
export function collectRepositoryContextGraphAnchors(
  references?: ContextSelectionReferences,
): string[] {
  if (!references) {
    return [];
  }

  const paths: string[] = [];
  const seen = new Set<string>();
  const add = (reference?: ContextFileReference) => {
    const relativePath = reference?.relativePath.trim();
    if (!relativePath || seen.has(relativePath)) {
      return;
    }
    if (
      paths.length >=
      REPOSITORY_CONTEXT_RETRIEVAL_POLICY.maximumGraphFileAnchors
    ) {
      return;
    }
    seen.add(relativePath);
    paths.push(relativePath);
  };

  add(references.currentFile);
  for (const file of references.openFiles ?? []) {
    add(file);
  }
  for (const file of references.gitDiffFiles ?? []) {
    add(file);
  }

  return paths;
}

/**
 * Derive a ContextSelectionBudget from the active model context window.
 * Floors at CONTEXT_SELECTION_DEFAULTS and caps at CONTEXT_SELECTION_LIMITS.
 */
export function deriveContextSelectionBudget(
  contextWindowTokens: number,
  options?: { maximumTokens?: number },
): ContextSelectionBudget {
  const safeWindow = Math.max(0, Math.floor(contextWindowTokens));
  const derivedTokens =
    options?.maximumTokens ??
    deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: Math.max(1, safeWindow),
    }).sections.repositoryTokens;
  const maximumTokens = Math.min(
    CONTEXT_SELECTION_LIMITS.MAXIMUM_TOKENS,
    Math.max(0, derivedTokens),
  );
  const budgetScale =
    maximumTokens / CONTEXT_SELECTION_DEFAULTS.MAXIMUM_TOKENS;

  return {
    maximumTokens,
    maximumItems: Math.min(
      CONTEXT_SELECTION_LIMITS.MAXIMUM_ITEMS,
      Math.ceil(CONTEXT_SELECTION_DEFAULTS.MAXIMUM_ITEMS * budgetScale),
    ),
    maximumFiles: Math.min(
      CONTEXT_SELECTION_LIMITS.MAXIMUM_FILES,
      Math.ceil(CONTEXT_SELECTION_DEFAULTS.MAXIMUM_FILES * budgetScale),
    ),
  };
}
