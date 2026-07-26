import type { ReviewDiffView } from '../../../vscode/webview/messages';

interface ReviewPanelProps {
  diff: ReviewDiffView | null;
  onRefresh: () => void;
  onFeedback: (content: string) => void;
  onExit: () => void;
}

export function ReviewPanel({ diff, onRefresh, onFeedback, onExit }: ReviewPanelProps) {
  const files = diff?.files ?? [];
  const summary = diff?.summary ?? { fileCount: 0, additions: 0, deletions: 0 };
  const feedbackPrompt = [
    'Review the current working-tree diff.',
    'Focus on bugs, regressions, missing tests, and risky changes.',
    'Do not edit files; provide findings only.',
  ].join('\n');

  return (
    <main className="thunder-main review-panel">
      <header className="review-panel__header">
        <div>
          <h2 className="review-panel__title">Review diff</h2>
          <p className="review-panel__subtitle">
            {diff?.branch ? `Branch ${diff.branch}` : 'Working tree'} · {summary.fileCount} files · +{summary.additions} / -{summary.deletions}
          </p>
        </div>
        <div className="review-panel__actions">
          <button type="button" className="btn btn--ghost" onClick={onRefresh}>Refresh</button>
          <button type="button" className="btn btn--ghost" onClick={onExit}>Back to chat</button>
          <button type="button" className="btn btn--primary" onClick={() => onFeedback(feedbackPrompt)}>Send feedback</button>
        </div>
      </header>
      {diff?.truncated && (
        <p className="settings-inline-note">Large diff truncated for sidebar review. Ask Review mode for targeted files when needed.</p>
      )}
      {files.length === 0 ? (
        <div className="review-panel__empty">
          <h3>No working-tree diff</h3>
          <p>Make changes or stage files, then refresh Review mode.</p>
        </div>
      ) : (
        <div className="review-panel__files">
          {files.map((file) => (
            <details key={file.path} className="review-file" open={files.length <= 3}>
              <summary className="review-file__summary">
                <span className="review-file__status">{file.status}</span>
                <span className="review-file__path">{file.path}</span>
                <span className="review-file__stats">+{file.additions} / -{file.deletions}</span>
              </summary>
              {file.diff ? (
                <pre className="review-file__diff"><code>{file.diff}</code></pre>
              ) : (
                <p className="settings-inline-note">No textual diff available for this file.</p>
              )}
            </details>
          ))}
        </div>
      )}
    </main>
  );
}
