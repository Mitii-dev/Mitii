

export const REVIEW_SKILL_ID = 'code-review-and-quality';
/** LLM code review of working-tree changes (Code Review button only). */
export const DEFAULT_CODE_REVIEW_PROMPT =
  'Perform a thorough code review of the current working-tree changes across correctness, readability, architecture, tests, and risk.';

export function mergeReviewSkillIds(ids: string[]): string[] {
  const without = ids.filter((id) => id !== REVIEW_SKILL_ID);
  return [REVIEW_SKILL_ID, ...without].slice(0, 3);
}

/** Stable fingerprint of git working-tree paths for Code Review re-run gating. */
export function reviewGitFileKey(
  files: readonly { path: string; status: string }[] | null | undefined,
): string {
  if (!files?.length) return '';
  return [...files]
    .map((f) => `${f.path}:${f.status}`)
    .sort()
    .join('|');
}
