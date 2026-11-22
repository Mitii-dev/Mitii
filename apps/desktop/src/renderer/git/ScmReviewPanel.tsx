import type { ReviewFinding } from '../../shared/reviewFindings.js';

interface ScmReviewPanelProps {
  findings: ReviewFinding[];
  error: string | null;
  running: boolean;
  onOpenDiff: (path: string) => void | Promise<void>;
}

export function ScmReviewPanel(props: ScmReviewPanelProps) {
  const { findings, error, running } = props;
  const findingsCount = findings.length;

  return (
    <div className="scm-pane__review">
      <header className="scm-pane__title scm-pane__title--sub">
        <span>
          {findingsCount > 0 ? `Code Review (${findingsCount})` : 'Code Review'}
        </span>
        {running ? (
          <span className="scm-review-status">Running…</span>
        ) : findingsCount === 0 && !error ? (
          <span className="scm-review-status">No findings yet</span>
        ) : null}
      </header>
      {error ? <p className="scm-empty scm-empty--error">{error}</p> : null}
      <div className="scm-review-list">
        {findingsCount === 0 && !running ? (
          <p className="scm-empty">
            Run Code Review to analyze working-tree changes. Findings appear
            here.
          </p>
        ) : null}
        {findings.map((finding, i) => (
          <button
            key={`${finding.path}:${finding.startLine ?? 0}:${i}`}
            type="button"
            className={`scm-finding scm-finding--${finding.severity}`}
            onClick={() => void props.onOpenDiff(finding.path)}
            title={finding.path}
          >
            <div className="scm-finding__meta">
              <span className="scm-finding__sev">{finding.severity}</span>
              {finding.category ? (
                <span className="scm-finding__cat">{finding.category}</span>
              ) : null}
            </div>
            <span className="scm-finding__path">
              {finding.path}
              {finding.startLine ? `:${finding.startLine}` : ''}
            </span>
            <span className="scm-finding__msg">{finding.content}</span>
            {finding.existingCode ? (
              <pre className="scm-finding__code">{finding.existingCode}</pre>
            ) : null}
            {finding.suggestionCode ? (
              <pre className="scm-finding__code scm-finding__code--suggest">
                {finding.suggestionCode}
              </pre>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
