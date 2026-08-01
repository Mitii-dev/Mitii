import type { ReviewDiffView } from '../protocol';

interface ReviewPanelProps {
  review: ReviewDiffView | null;
  onRefresh: () => void;
}

export function ReviewPanel({ review, onRefresh }: ReviewPanelProps) {
  const files = review?.files ?? [];

  return (
    <section className="review-panel" aria-label="Review diff">
      <header className="review-panel__header">
        <div>
          <h3 className="review-panel__title">Review diff</h3>
          <p className="review-panel__subtitle">
            {review?.summary ?? 'Working tree'} · {files.length} file
            {files.length === 1 ? '' : 's'}
          </p>
        </div>
        <button type="button" className="btn ghost" onClick={onRefresh}>
          Refresh
        </button>
      </header>
      {files.length === 0 ? (
        <div className="panel-empty">
          <p>No working-tree diff. Make changes, then refresh.</p>
        </div>
      ) : (
        <ul className="review-file-list">
          {files.map((file) => (
            <li key={file.path} className="review-file">
              <span className="review-file__status">{file.status}</span>
              <span className="review-file__path mono">{file.path}</span>
            </li>
          ))}
        </ul>
      )}
      {review?.patchPreview ? (
        <pre className="review-patch">
          <code>{review.patchPreview}</code>
        </pre>
      ) : null}
    </section>
  );
}
