import { type AppApi } from '../app/appApi';
import { reviewGitFileKey } from '../app/reviewHelpers';

export function ComposerCodeReviewRow({ api }: { api: AppApi }) {
  const {
    codeReviewFileKey,
    codeReviewRunning,
    dismissReviewFindings,
    fixReviewFindings,
    review,
    reviewFindings,
    runCodeReview,
    running,
    ui,
  } = api;

  if (!(ui.features.codeReviewButton === true)) return null;

  return (
    <div className="composer-code-review-row">
      <div className="composer-code-review-row__inner">
        {(review?.files.length ?? 0) > 0 ? (
          <span className="composer-git-count">
            {review!.files.length}{' '}
            {review!.files.length === 1 ? 'File' : 'Files'}
          </span>
        ) : null}
        {reviewFindings.length > 0 ? (
          <button
            type="button"
            className="composer-code-review-link"
            disabled={running}
            title="Clear review findings"
            onClick={() => dismissReviewFindings()}
          >
            Dismiss
          </button>
        ) : null}
        {reviewFindings.some((f) => f.status !== 'fixed') ? (
          <button
            type="button"
            className="composer-code-review-btn composer-code-review-btn--fix"
            disabled={running}
            title="Fix all open findings in Agent mode"
            onClick={() => fixReviewFindings()}
          >
            Fix all
          </button>
        ) : null}
        {(() => {
          const gitKey = reviewGitFileKey(review?.files);
          const hasGitFiles = (review?.files.length ?? 0) > 0;
          const blockedByPriorReview =
            codeReviewFileKey !== null &&
            codeReviewFileKey === gitKey;
          const canRunCodeReview =
            hasGitFiles &&
            !running &&
            !blockedByPriorReview;
          return (
            <button
              type="button"
              className="composer-code-review-btn"
              disabled={!canRunCodeReview}
              title={
                blockedByPriorReview
                  ? 'Dismiss findings or wait for new git changes before running Code Review again'
                  : 'LLM code review of all git working-tree changes'
              }
              onClick={() => runCodeReview()}
            >
              {codeReviewRunning ? 'Reviewing…' : 'Code Review'}
            </button>
          );
        })()}
      </div>
    </div>
  );
}
