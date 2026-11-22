/**
 * Dual-scope contract for the composer Working Tree review strip.
 *
 * - Review / Files list → this chat's Mitii run edits (`chatFiles`)
 * - Code Review (N) → full git working tree (`gitFiles`), feature-gated
 * - Findings / Fix → only when Code Review feature is enabled
 */

export type ReviewBarFile = {
  path: string;
  status: string;
};

export type ReviewBarScopeInput = {
  gitFiles: readonly ReviewBarFile[];
  chatFiles: readonly ReviewBarFile[];
  findingsCount: number;
  showCodeReview: boolean;
  running?: boolean;
};

export type ReviewBarScope = {
  /** Files shown under Review / Files (this chat only). */
  chatFiles: ReviewBarFile[];
  chatFileCount: number;
  /** Working-tree file count for the Code Review CTA. */
  gitFileCount: number;
  summaryLabel: string;
  visible: boolean;
  canExpandReview: boolean;
  canRunCodeReview: boolean;
  showFindingsUi: boolean;
  codeReviewButtonLabel: string;
};

function pluralFiles(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Resolve what the review bar shows and which actions are enabled.
 * Pure — safe to unit-test without React or the host bridge.
 */
export function resolveReviewBarScope(
  input: ReviewBarScopeInput,
): ReviewBarScope {
  const chatFiles = input.chatFiles.map((f) => ({
    path: f.path,
    status: f.status,
  }));
  const chatFileCount = chatFiles.length;
  const gitFileCount = input.gitFiles.length;
  const showFindingsUi = input.showCodeReview === true;
  const running = input.running === true;

  // Review block: this-chat edits / findings only.
  // Code Review CTA lives outside this bar (top-right of the composer dock).
  const visible =
    chatFileCount > 0 || (showFindingsUi && input.findingsCount > 0);

  let summaryLabel: string;
  if (chatFileCount > 0) {
    summaryLabel = pluralFiles(chatFileCount, 'file change');
  } else if (showFindingsUi && input.findingsCount > 0) {
    summaryLabel = 'Review findings';
  } else {
    summaryLabel = pluralFiles(0, 'file change');
  }

  return {
    chatFiles,
    chatFileCount,
    gitFileCount,
    summaryLabel,
    visible,
    canExpandReview: chatFileCount > 0,
    canRunCodeReview: showFindingsUi && gitFileCount > 0 && !running,
    showFindingsUi,
    codeReviewButtonLabel:
      gitFileCount > 0
        ? `Code Review (${gitFileCount})`
        : 'Code Review',
  };
}

/** Map run file-change entries into the bar's file DTO. */
export function chatFilesFromRunChanges(
  files: readonly { path: string; status: string }[] | null | undefined,
): ReviewBarFile[] {
  if (!files?.length) return [];
  return files.map((f) => ({ path: f.path, status: String(f.status) }));
}

/** Map git review-diff entries into the bar's file DTO. */
export function gitFilesFromReview(
  files: readonly { path: string; status: string }[] | null | undefined,
): ReviewBarFile[] {
  if (!files?.length) return [];
  return files.map((f) => ({ path: f.path, status: String(f.status) }));
}
