import { useState } from 'react';

import type { DesktopSuspension } from '../shared/suspension.js';

interface ApprovalCardProps {
  suspension: DesktopSuspension;
  busy?: boolean;
  onApprove: () => void;
  onDeny: () => void;
  onClarify: (answer: string) => void;
  onContinue: (guidance?: string) => void;
  onStop: () => void;
}

export function ApprovalCard({
  suspension,
  busy,
  onApprove,
  onDeny,
  onClarify,
  onContinue,
  onStop,
}: ApprovalCardProps) {
  const [clarifyText, setClarifyText] = useState('');
  const [planExpanded, setPlanExpanded] = useState(true);
  const isClarify = suspension.kind === 'clarification_required';
  const isPlan = suspension.kind === 'plan_approval_required';
  const isContinue = suspension.kind === 'continue_required';
  const isGrant = suspension.kind === 'grant_expansion_required';
  const approval = suspension.approval;
  const options = suspension.clarificationOptions ?? [];
  const planSteps = suspension.plan?.steps ?? [];

  const title = isClarify
    ? 'Clarification needed'
    : isPlan
      ? 'Plan approval required'
      : isContinue
        ? 'A bit more research needed'
        : isGrant
          ? 'Workspace access expansion'
          : 'Approval required';

  const prompt =
    (isContinue
      ? suspension.continuePrompt ?? suspension.rationale
      : suspension.clarificationPrompt) ??
    suspension.rationale ??
    (isPlan
      ? 'Review the plan, then approve to continue or reject to stop.'
      : 'I need a bit more detail before continuing.');

  return (
    <div className="approval-card" role="dialog" aria-label={title}>
      <h3>{title}</h3>
      <p className="approval-card__prompt">{prompt}</p>

      {!isClarify && !isPlan && !isContinue && !isGrant && approval ? (
        <div className="approval-meta">
          <span className="mono">{approval.toolName}</span>
          {approval.paths?.length ? (
            <span className="mono">{approval.paths.join(', ')}</span>
          ) : null}
        </div>
      ) : null}

      {isGrant && suspension.grantExpansion?.extraPaths?.length ? (
        <div className="approval-meta">
          <span className="mono">
            {suspension.grantExpansion.extraPaths.slice(0, 8).join(', ')}
          </span>
        </div>
      ) : null}

      {isPlan && suspension.plan ? (
        <div className="approval-meta">
          <span>{suspension.plan.objective}</span>
          <span className="mono">
            {planSteps.length} step{planSteps.length === 1 ? '' : 's'}
          </span>
        </div>
      ) : null}

      {isPlan ? (
        <div className="approval-plan-panel">
          <button
            type="button"
            className="approval-plan-panel__toggle"
            onClick={() => setPlanExpanded((value) => !value)}
            aria-expanded={planExpanded}
          >
            {planExpanded ? 'Collapse plan' : 'Expand plan'}
          </button>
          {planExpanded ? (
            planSteps.length > 0 ? (
              <ol className="approval-plan-panel__steps">
                {planSteps.map((step, index) => (
                  <li key={step.id}>
                    <span className="approval-plan-panel__index">
                      {index + 1}
                    </span>
                    <div className="approval-plan-panel__body">
                      <strong>{step.title}</strong>
                      {step.detail ? <p>{step.detail}</p> : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : suspension.planText ? (
              <pre className="approval-plan">{suspension.planText}</pre>
            ) : (
              <p className="approval-plan-panel__empty">
                Plan details are in the chat reply above.
              </p>
            )
          ) : null}
        </div>
      ) : suspension.planText ? (
        <pre className="approval-plan">{suspension.planText}</pre>
      ) : null}

      {approval?.arguments ? (
        <pre className="approval-plan">
          {typeof approval.arguments === 'string'
            ? approval.arguments
            : JSON.stringify(approval.arguments, null, 2).slice(0, 1200)}
        </pre>
      ) : null}

      {isClarify && options.length > 0 ? (
        <div className="approval-options">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                onClarify(
                  option.description
                    ? `${option.label} — ${option.description}`
                    : option.label,
                )
              }
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      {isClarify || isContinue ? (
        <div className="approval-clarify">
          <textarea
            value={clarifyText}
            disabled={busy}
            placeholder={
              isContinue
                ? 'Optional guidance…'
                : 'Type your answer…'
            }
            rows={3}
            onChange={(e) => setClarifyText(e.target.value)}
          />
        </div>
      ) : null}

      <div className="approval-actions">
        {isClarify ? (
          <>
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !clarifyText.trim()}
              onClick={() => onClarify(clarifyText.trim())}
            >
              Submit
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={onStop}>
              Stop
            </button>
          </>
        ) : isContinue ? (
          <>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => onContinue(clarifyText.trim() || undefined)}
            >
              Continue
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={onStop}>
              Stop
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={onApprove}
            >
              {isPlan ? 'Approve plan' : 'Approve'}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={onDeny}>
              Deny
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={onStop}>
              Stop
            </button>
          </>
        )}
      </div>
    </div>
  );
}
