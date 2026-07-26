import type { SuspensionPayload } from '../protocol';

interface ApprovalCardsProps {
  suspension: SuspensionPayload;
  clarifyText: string;
  onClarifyChange: (value: string) => void;
  onSubmitClarify: (answer: string) => void;
  onStop: () => void;
  onApprove: () => void;
  onDeny: () => void;
  onShowInlineDiff: (approvalId: string) => void;
}

export function ApprovalCards({
  suspension,
  clarifyText,
  onClarifyChange,
  onSubmitClarify,
  onStop,
  onApprove,
  onDeny,
  onShowInlineDiff,
}: ApprovalCardsProps) {
  const isClarify = suspension.kind === 'clarification_required';
  const approval = suspension.approval;

  return (
    <div className="card approval-card">
      <h3>{isClarify ? 'Clarification needed' : 'Approval required'}</h3>
      <p>
        {suspension.clarificationPrompt ??
          suspension.rationale ??
          'Continue the run.'}
      </p>
      {!isClarify && approval ? (
        <div className="approval-meta">
          <span className="mono">{approval.toolName}</span>
          {approval.paths?.length ? (
            <span className="mono">{approval.paths.join(', ')}</span>
          ) : null}
        </div>
      ) : null}
      {isClarify ? (
        <>
          <textarea
            rows={3}
            value={clarifyText}
            onChange={(e) => onClarifyChange(e.target.value)}
            placeholder="Your answer"
          />
          <div className="card-actions">
            <button
              type="button"
              className="btn"
              onClick={() => onSubmitClarify(clarifyText)}
            >
              Submit
            </button>
            <button type="button" className="btn ghost" onClick={onStop}>
              Stop
            </button>
          </div>
        </>
      ) : (
        <div className="card-actions">
          <button type="button" className="btn" onClick={onApprove}>
            Approve
          </button>
          <button type="button" className="btn ghost" onClick={onDeny}>
            Deny
          </button>
          {approval?.approvalId ? (
            <button
              type="button"
              className="btn ghost"
              onClick={() => onShowInlineDiff(approval.approvalId)}
            >
              Open inline diff
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
