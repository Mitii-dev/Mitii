import type { ClarificationOptionView, SuspensionPayload } from '../protocol';

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

function shortClarifyText(text: string | undefined, max = 480): string | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return undefined;
  // Host-composed prompts must never render in the card.
  if (
    cleaned.includes('<<<MITII_') ||
    cleaned.startsWith('Workspace file map') ||
    cleaned.startsWith('Pinned file') ||
    cleaned.startsWith('Pinned context:')
  ) {
    return undefined;
  }
  if (cleaned.length > max) return `${cleaned.slice(0, max - 1)}…`;
  return cleaned;
}

function optionAnswer(option: ClarificationOptionView): string {
  return option.description
    ? `${option.label} — ${option.description}`
    : option.label;
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
  const isPlan = suspension.kind === 'plan_approval_required';
  const approval = suspension.approval;
  const options = suspension.clarificationOptions ?? [];
  const prompt =
    shortClarifyText(suspension.clarificationPrompt) ??
    (suspension.rationale && !/^mode=/.test(suspension.rationale)
      ? shortClarifyText(suspension.rationale)
      : undefined) ??
    (isPlan
      ? 'Review the plan, then approve to continue or reject to stop.'
      : 'I need a bit more detail before continuing.');

  const title = isClarify
    ? 'Clarification needed'
    : isPlan
      ? 'Plan approval required'
      : 'Approval required';

  return (
    <div className="card approval-card">
      <h3>{title}</h3>
      <p className="approval-card__prompt">{prompt}</p>
      {!isClarify && !isPlan && approval ? (
        <div className="approval-meta">
          <span className="mono">{approval.toolName}</span>
          {approval.paths?.length ? (
            <span className="mono">{approval.paths.join(', ')}</span>
          ) : null}
        </div>
      ) : null}
      {isPlan && suspension.plan ? (
        <div className="approval-meta">
          <span>{suspension.plan.title}</span>
          <span className="mono">
            {suspension.plan.steps.length} step
            {suspension.plan.steps.length === 1 ? '' : 's'}
          </span>
        </div>
      ) : null}
      {isClarify ? (
        <>
          {options.length > 0 ? (
            <div className="clarify-options" role="group" aria-label="Choices">
              {options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="clarify-option"
                  onClick={() => onSubmitClarify(optionAnswer(option))}
                >
                  <span className="clarify-option__label">{option.label}</span>
                  {option.description ? (
                    <span className="clarify-option__desc">
                      {option.description}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
          <textarea
            rows={3}
            value={clarifyText}
            onChange={(e) => onClarifyChange(e.target.value)}
            placeholder={
              options.length > 0
                ? 'Or type your own answer…'
                : 'Your answer'
            }
          />
          <div className="card-actions">
            <button
              type="button"
              className="btn"
              onClick={() => onSubmitClarify(clarifyText)}
              disabled={!clarifyText.trim()}
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
            {isPlan ? 'Approve plan' : 'Approve'}
          </button>
          <button type="button" className="btn ghost" onClick={onDeny}>
            {isPlan ? 'Reject plan' : 'Deny'}
          </button>
          {!isPlan && approval?.approvalId ? (
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
