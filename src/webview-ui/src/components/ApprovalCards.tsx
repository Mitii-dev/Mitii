import type { ApprovalRequestView } from '../../../vscode/webview/messages';

interface ApprovalCardsProps {
  approvals: ApprovalRequestView[];
  onResolve: (id: string, decision: 'approved' | 'denied') => void;
  onApproveAll: () => void;
}

export function ApprovalCards({ approvals, onResolve, onApproveAll }: ApprovalCardsProps) {
  if (approvals.length === 0) return null;

  const hasOnlyFileChanges = approvals.every((req) => req.toolName === 'write_file' || req.toolName === 'apply_patch');
  const pendingLabel = hasOnlyFileChanges
    ? `file change${approvals.length > 1 ? 's' : ''}`
    : `action${approvals.length > 1 ? 's' : ''}`;

  return (
    <div className="approval-panel">
      <div className="approval-panel__header">
        <div>
          <h3 className="approval-panel__title">Permission required</h3>
          <p className="approval-panel__subtitle">
            {approvals.length} {pendingLabel} waiting for your approval
          </p>
        </div>
        {approvals.length > 1 && (
          <button type="button" className="btn btn--primary btn--small" onClick={onApproveAll}>
            Approve all
          </button>
        )}
      </div>

      <div className="approval-panel__list">
        {approvals.map((req) => (
          <article key={req.id} className={`approval-card approval-card--${req.risk}`}>
            <div className="approval-card__icon" aria-hidden="true">
              {req.toolName === 'write_file' ? '✎' : '⚙'}
            </div>
            <div className="approval-card__body">
              <div className="approval-card__header">
                <span className="approval-card__tool">{formatToolLabel(req.toolName)}</span>
                <span className={`risk-badge risk-badge--${req.risk}`}>{req.risk}</span>
              </div>
              {req.files.length > 0 && (
                <code className="approval-card__path">{req.files[0]}</code>
              )}
              <p className="approval-card__summary">{req.inputPreview}</p>
              {req.contentLength != null && req.contentLength > 0 && (
                <p className="approval-card__meta">
                  {req.contentLength.toLocaleString()} characters will be written
                </p>
              )}
              <p className="approval-card__reason">{req.reason}</p>
            </div>
            <div className="approval-card__actions">
              <button
                type="button"
                className="btn btn--primary btn--small"
                onClick={() => onResolve(req.id, 'approved')}
              >
                Approve
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => onResolve(req.id, 'denied')}
              >
                Deny
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function formatToolLabel(toolName: string): string {
  if (toolName === 'write_file') return 'Write file';
  if (toolName === 'apply_patch') return 'Apply patch';
  if (toolName === 'run_command') return 'Run command';
  return toolName;
}
