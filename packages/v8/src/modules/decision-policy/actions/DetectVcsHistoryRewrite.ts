/**
 * Detect DCO / Signed-off-by / history-rewrite asks that need git commit
 * metadata changes rather than workspace file patches.
 */
const VCS_HISTORY_REWRITE =
  /\b(?:dco|signed-off-by|sign[\s-]?offs?|incorrectly\s+signed\s+off|missing\s+signed-off)\b/i;

const VCS_REWRITE_OPS =
  /\b(?:git\s+(?:rebase|commit\s+--amend|filter-branch|filter-repo)|force-with-lease|rewrite\s+(?:commit\s+)?history|amend\s+commits?|add\s+signed-off-by)\b/i;

const COMMITS_RANGE_SIGNOFF =
  /\b(?:all\s+)?commits?\b[\s\S]{0,120}\b(?:signed[\s-]?off|signoff|sign-off|dco)\b/i;

export function looksLikeVcsHistoryRewrite(message: string): boolean {
  const text = message.trim();
  if (text.length < 8) {
    return false;
  }
  return (
    VCS_HISTORY_REWRITE.test(text) ||
    VCS_REWRITE_OPS.test(text) ||
    COMMITS_RANGE_SIGNOFF.test(text)
  );
}
