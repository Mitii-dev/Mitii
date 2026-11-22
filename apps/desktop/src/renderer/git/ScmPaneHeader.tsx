import type { GitWorkingTreeSnapshot } from '../../shared/git/workingTree.js';
import { IconRefresh, IconStop } from '../shell/ActivityIcons.js';
import { JOB_LABEL, type ScmJob } from './scmTypes.js';

interface ScmPaneHeaderProps {
  git: GitWorkingTreeSnapshot | null;
  activeJob: ScmJob | null;
  busy: boolean;
  showCodeReview: boolean;
  findingsCount: number;
  onStop: () => void;
  onCodeReview: () => void;
  onRefresh: () => void;
}

export function ScmPaneHeader(props: ScmPaneHeaderProps) {
  const { git, activeJob, busy, showCodeReview, findingsCount } = props;
  const codeReviewLabel =
    findingsCount > 0 ? `Code Review (${findingsCount})` : 'Code Review';

  return (
    <header className="scm-pane__title">
      <span className="scm-pane__title-left">
        <span>
          Source Control
          {git?.ok && (git.changeCount ?? git.files.length) > 0 ? (
            <span className="scm-pane__badge" title="Changed files">
              {git.changeCount ?? git.files.length}
            </span>
          ) : null}
        </span>
        {activeJob ? (
          <span className="scm-pane__running" aria-live="polite">
            {JOB_LABEL[activeJob]}…
          </span>
        ) : null}
      </span>
      <div className="scm-pane__title-actions">
        {activeJob ? (
          <button
            type="button"
            className="scm-icon-btn scm-icon-btn--stop"
            title={`Stop ${JOB_LABEL[activeJob]}`}
            aria-label={`Stop ${JOB_LABEL[activeJob]}`}
            onClick={props.onStop}
          >
            <IconStop size={13} />
          </button>
        ) : null}
        {showCodeReview ? (
          <button
            type="button"
            className="scm-text-btn"
            disabled={Boolean(activeJob) || !git?.files.length}
            title="LLM code review of working-tree changes"
            onClick={props.onCodeReview}
          >
            {activeJob === 'code-review' ? 'Code Review…' : codeReviewLabel}
          </button>
        ) : null}
        <button
          type="button"
          className="scm-icon-btn"
          title="Refresh"
          aria-label="Refresh"
          disabled={busy}
          onClick={props.onRefresh}
        >
          <IconRefresh size={13} />
        </button>
      </div>
    </header>
  );
}
