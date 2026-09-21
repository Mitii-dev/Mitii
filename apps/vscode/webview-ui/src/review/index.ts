/**
 * Composer review strip — dual-scope contract.
 *
 * | Surface | Scope | LLM |
 * |---|---|---|
 * | Summary count + Files tab + Review | This chat's Mitii run edits | No |
 * | Code Review (N) | Full git working tree (`N` files) | Yes |
 * | Findings / Fix / severity | Only when Settings → Features → Code Review is on | After Code Review |
 *
 * Host still refreshes `ReviewDiffView` via `refreshReviewDiff` so the Code Review
 * badge stays accurate. Undo All / Keep All bind only to `RunFileChangesView`.
 *
 * Pure model: `reviewBarModel.ts` (unit-tested). UI shells stay under 300 lines.
 */

export { WorkingTreeReviewBar } from './WorkingTreeReviewBar';
export { ComposerReviewStrip } from './ComposerReviewStrip';
export type { ReviewFindingChip } from './reviewFindingTypes';
export {
  resolveReviewBarScope,
  chatFilesFromRunChanges,
  gitFilesFromReview,
} from './reviewBarModel';
export type {
  ReviewBarFile,
  ReviewBarScope,
  ReviewBarScopeInput,
} from './reviewBarModel';
export {
  selectLatestRunChanges,
  composerNeedsReviewStrip,
} from './selectLatestRunChanges';
