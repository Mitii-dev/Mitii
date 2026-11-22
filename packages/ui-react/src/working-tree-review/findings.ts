import type { ReviewFindingChip, ReviewFindingSummary } from './types.js';

/** Split findings into open / fixed and flag a fully resolved review. */
export function summarizeReviewFindings(
  findings: readonly ReviewFindingChip[],
): ReviewFindingSummary {
  const open = findings.filter((f) => f.status !== 'fixed');
  const fixed = findings.filter((f) => f.status === 'fixed');
  return {
    open,
    fixed,
    total: findings.length,
    complete: findings.length > 0 && open.length === 0 && fixed.length > 0,
  };
}
