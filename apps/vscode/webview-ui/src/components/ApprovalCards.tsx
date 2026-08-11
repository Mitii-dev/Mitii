import { useState } from 'react';

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

function extractField(text: string | undefined, label: string): string | undefined {
  if (!text) return undefined;
  const match = text.match(new RegExp(`^${label}:\\s*(.+)$`, 'im'));
  return match?.[1]?.trim();
}

function extractListSection(
  text: string | undefined,
  heading: string,
  maxItems = 8,
): string[] {
  if (!text) return [];
  const lines = text.split('\n');
  const start = lines.findIndex((line) =>
    new RegExp(`^${heading}:\\s*$`, 'i').test(line.trim()),
  );
  if (start < 0) return [];
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[A-Z][\w\s]+:\s*/.test(trimmed)) break;
    const item = trimmed.match(/^(?:[-*]|\d+(?:\.\d+)*\.)\s+(.+)$/)?.[1];
    if (item) items.push(item.trim());
    if (items.length >= maxItems) break;
  }
  return items;
}

function compactText(text: string | undefined, max = 900): string | undefined {
  if (!text) return undefined;
  const cleaned = text.trim();
  if (!cleaned) return undefined;
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

function shellQuoteArg(value: string): string {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function approvalCommandText(approval: SuspensionPayload['approval']): string | undefined {
  const args = approval?.arguments;
  if (
    approval?.toolName === 'run_command' &&
    args &&
    typeof args === 'object' &&
    Array.isArray((args as { argv?: unknown }).argv)
  ) {
    return (args as { argv: unknown[] }).argv
      .map((arg) => shellQuoteArg(String(arg)))
      .join(' ');
  }
  return undefined;
}

function approvalArgumentsText(
  approval: SuspensionPayload['approval'],
): string | undefined {
  if (!approval?.arguments || approvalCommandText(approval)) return undefined;
  try {
    return JSON.stringify(approval.arguments, null, 2);
  } catch {
    return String(approval.arguments);
  }
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
  const [planExpanded, setPlanExpanded] = useState(true);
  const isClarify = suspension.kind === 'clarification_required';
  const isPlan = suspension.kind === 'plan_approval_required';
  const approval = suspension.approval;
  const options = suspension.clarificationOptions ?? [];
  const planText = suspension.planText;
  const commandText = approvalCommandText(approval);
  const argumentsText = approvalArgumentsText(approval);
  const objective = extractField(planText, 'Objective');
  const scope = extractField(planText, 'Scope');
  const verification = extractField(planText, 'Verification');
  const riskItems = extractListSection(planText, 'Risks', 3);
  const fallbackPlanSteps = extractListSection(planText, 'Plan', 8);
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
      {!isClarify && !isPlan && commandText ? (
        <div className="approval-command">
          <span>Command to run</span>
          <pre className="approval-plan__raw approval-plan__raw--command">
            {commandText}
          </pre>
        </div>
      ) : null}
      {!isClarify && !isPlan && argumentsText ? (
        <div className="approval-command">
          <span>Tool arguments</span>
          <pre className="approval-plan__raw approval-plan__raw--command">
            {compactText(argumentsText, 1200)}
          </pre>
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
      {isPlan ? (
        <div className="approval-plan">
          <button
            type="button"
            className="approval-plan__toggle"
            onClick={() => setPlanExpanded((value) => !value)}
            aria-expanded={planExpanded}
          >
            {planExpanded ? 'Collapse plan' : 'Expand plan'}
          </button>
          {planExpanded ? (
            <>
              {objective || scope || verification ? (
                <div className="approval-plan__facts">
                  {objective ? (
                    <div>
                      <span>Objective</span>
                      <strong>{objective}</strong>
                    </div>
                  ) : null}
                  {scope ? (
                    <div>
                      <span>Scope</span>
                      <strong>{scope}</strong>
                    </div>
                  ) : null}
                  {verification ? (
                    <div>
                      <span>Verify</span>
                      <strong>{verification}</strong>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {suspension.plan?.steps.length ? (
                <ol className="approval-plan__steps">
                  {suspension.plan.steps.map((step, index) => (
                    <li key={step.id}>
                      <span>{index + 1}</span>
                      <p>{step.title}</p>
                    </li>
                  ))}
                </ol>
              ) : fallbackPlanSteps.length ? (
                <ol className="approval-plan__steps">
                  {fallbackPlanSteps.map((step, index) => (
                    <li key={`${index}:${step}`}>
                      <span>{index + 1}</span>
                      <p>{step}</p>
                    </li>
                  ))}
                </ol>
              ) : planText ? (
                <pre className="approval-plan__raw">{compactText(planText)}</pre>
              ) : null}
              {riskItems.length ? (
                <div className="approval-plan__risks">
                  <span>Risks</span>
                  {riskItems.join(' · ')}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
      {!isClarify && !isPlan && approval?.proposedText ? (
        <pre className="approval-plan__raw approval-plan__raw--diff">
          {compactText(approval.proposedText, 1200)}
        </pre>
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
