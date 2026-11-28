import { useState } from 'react';

import type { DesktopSuspension } from '../../shared/suspension.js';

interface ApprovalCardProps {
  suspension: DesktopSuspension;
  busy?: boolean;
  /** Composer mode — Build switches to agent and implements. */
  mode?: string;
  onApprove: () => void;
  onDeny: () => void;
  onClarify: (answer: string) => void;
  onContinue: (guidance?: string) => void;
  onStop: () => void;
}

function isHollowPlanNeed(suspension: DesktopSuspension): boolean {
  if (suspension.clarifyOrigin === 'hollow_plan') return true;
  if (suspension.kind !== 'clarification_required') return false;
  const text = `${suspension.clarificationPrompt ?? ''} ${suspension.rationale ?? ''}`.toLowerCase();
  return text.includes('plan needed') || text.includes('plan is needed');
}

export function ApprovalCard({
  suspension,
  busy,
  mode: _mode,
  onApprove,
  onDeny,
  onClarify,
  onContinue,
  onStop,
}: ApprovalCardProps) {
  const [clarifyText, setClarifyText] = useState('');
  const isClarify = suspension.kind === 'clarification_required';
  const isHollowPlan = isClarify && isHollowPlanNeed(suspension);
  const isPlan = suspension.kind === 'plan_approval_required';
  const isContinue = suspension.kind === 'continue_required';
  const isGrant = suspension.kind === 'grant_expansion_required';
  const approval = suspension.approval;
  const options = suspension.clarificationOptions ?? [];
  const planSteps = suspension.plan?.steps ?? [];
  // Long plans start collapsed so Build stays above the fold.
  const [planExpanded, setPlanExpanded] = useState(
    () => planSteps.length > 0 && planSteps.length <= 6,
  );

  const title = isHollowPlan
    ? 'Plan'
    : isClarify
      ? 'Clarification needed'
      : isPlan
        ? 'Plan'
        : isContinue
          ? 'Continue to finish edits'
          : isGrant
            ? 'Workspace access expansion'
            : 'Approval required';

  // Chips carry the options — keep the card prompt short when choices exist.
  const prompt = isHollowPlan
    ? 'Review, then build.'
    : isClarify
      ? options.length > 0
        ? 'Pick a scope below to continue.'
        : (suspension.clarificationPrompt ??
          suspension.rationale ??
          'I need a bit more detail before continuing.')
      : (isContinue
          ? suspension.continuePrompt ?? suspension.rationale
          : isPlan
            ? suspension.plan?.objective
              ? undefined
              : 'Review the plan, then build.'
            : suspension.rationale) ??
        (isPlan
          ? 'Review the plan, then build.'
          : 'I need a bit more detail before continuing.');

  return (
    <div className="approval-card" role="dialog" aria-label={title}>
      <h3>{title}</h3>
      {prompt ? <p className="approval-card__prompt">{prompt}</p> : null}

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
      ) : null}

      {approval?.arguments ? (
        <pre className="approval-plan">
          {typeof approval.arguments === 'string'
            ? approval.arguments
            : JSON.stringify(approval.arguments, null, 2).slice(0, 1200)}
        </pre>
      ) : null}

      {isClarify && !isHollowPlan && options.length > 0 ? (
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

      {(isClarify && !isHollowPlan) || isContinue ? (
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
        {isHollowPlan ? (
          <>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => onClarify('go ahead')}
            >
              Build
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={onStop}>
              Stop
            </button>
          </>
        ) : isClarify ? (
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
              {isPlan ? 'Build' : 'Approve'}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={onDeny}>
              {isPlan ? 'Discard' : 'Deny'}
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
