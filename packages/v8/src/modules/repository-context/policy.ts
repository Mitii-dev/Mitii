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
 * True when `relativePath` is the folder itself or a descendant.
 */
export function pathMatchesFolderPrefix(
  relativePath: string,
  folderPrefix: string,
): boolean {
  const path = relativePath.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const prefix = folderPrefix.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!path || !prefix) {
    return false;
  }
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Keep editor/git/explicit priors that sit inside the user-mentioned folder, plus
 * any paths that were already named as explicit file filters.
 *
 * Unrelated workspace tabs and dirty files must not fill an empty retrieval
 * (or narrow the write grant) away from the mentioned folder.
 */
export function restrictContextReferencesToFolderPrefix(
  references: ContextSelectionReferences | undefined,
  folderPrefix: string | undefined,
  extraFilePaths: readonly string[] = [],
): ContextSelectionReferences | undefined {
  if (!references || !folderPrefix) {
    return references;
  }

  const allowedFiles = new Set(
    extraFilePaths
      .map((path) => path.trim().replace(/\\/g, "/"))
      .filter(Boolean),
  );
  const keep = (reference?: ContextFileReference) => {
    if (!reference) {
      return false;
    }
    const relativePath = reference.relativePath.trim().replace(/\\/g, "/");
    return (
      allowedFiles.has(relativePath) ||
      pathMatchesFolderPrefix(relativePath, folderPrefix)
    );
  };

  const currentFile = keep(references.currentFile)
    ? references.currentFile
    : undefined;
  const currentSelection =
    references.currentSelection &&
    keep(references.currentSelection)
      ? references.currentSelection
      : undefined;
  const openFiles = (references.openFiles ?? []).filter(keep);
  const gitDiffFiles = (references.gitDiffFiles ?? []).filter(keep);
  const diagnosticFiles = (references.diagnosticFiles ?? []).filter(keep);
  const recentEditFiles = (references.recentEditFiles ?? []).filter(keep);
  const explicitFiles = (references.explicitFiles ?? []).filter(keep);
  const pinnedFiles = (references.pinnedFiles ?? []).filter(keep);

  if (
    !currentFile &&
    !currentSelection &&
    openFiles.length === 0 &&
    gitDiffFiles.length === 0 &&
    diagnosticFiles.length === 0 &&
    recentEditFiles.length === 0 &&
    explicitFiles.length === 0 &&
    pinnedFiles.length === 0
  ) {
    return undefined;
  }

  return {
    ...(currentFile ? { currentFile } : {}),
    ...(currentSelection ? { currentSelection } : {}),
    ...(openFiles.length > 0 ? { openFiles } : {}),
    ...(gitDiffFiles.length > 0 ? { gitDiffFiles } : {}),
    ...(diagnosticFiles.length > 0 ? { diagnosticFiles } : {}),
    ...(recentEditFiles.length > 0 ? { recentEditFiles } : {}),
    ...(explicitFiles.length > 0 ? { explicitFiles } : {}),
    ...(pinnedFiles.length > 0 ? { pinnedFiles } : {}),
  };
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
