import { useEffect, useState } from 'react';
import type {
  AgentLiveStatusView,
  PlanStepView,
  PlanView,
} from '../../../vscode/webview/messages';
import type { ThunderMode } from '../../../features/ce/session/ThunderSession';

interface PlanPanelProps {
  plan: PlanView | null;
  mode?: ThunderMode;
  loading?: boolean;
  liveStatus?: AgentLiveStatusView | null;
}

const STATUS_LABEL: Record<PlanStepView['status'], string> = {
  pending: 'Pending',
  running: 'Running',
  done: 'Done',
  blocked: 'Awaiting approval',
  failed: 'Failed',
  blocked_by_dependency: 'Waiting',
};

function statusGlyph(status: PlanStepView['status']): string {
  switch (status) {
    case 'done':
      return '✓';
    case 'running':
      return '•';
    case 'blocked':
    case 'failed':
      return '!';
    default:
      return '';
  }
}

function PlanStepRow({ step, index }: { step: PlanStepView; index: number }) {
  const [expanded, setExpanded] = useState(step.status === 'running');
  const hasDetails = Boolean(
    step.objective || step.tools?.length || step.successCriteria?.length || step.dependsOn?.length
  );

  return (
    <li className={`plan-step plan-step--${step.status}`}>
      <button
        type="button"
        className="plan-step__row"
        onClick={() => hasDetails && setExpanded((value) => !value)}
        aria-expanded={hasDetails ? expanded : undefined}
        disabled={!hasDetails}
      >
        <span className={`plan-step__check plan-step__check--${step.status}`} aria-hidden="true">
          {statusGlyph(step.status)}
        </span>
        <span className="plan-step__index">{index + 1}</span>
        <span className="plan-step__body">
          <span className="plan-step__title">{step.title}</span>
          {step.files && step.files.length > 0 && (
            <span className="plan-step__files">{step.files.join(', ')}</span>
          )}
        </span>
        <span className="plan-step__meta">
          <span className={`plan-step__risk plan-step__risk--${step.risk}`}>{step.risk}</span>
          <span className="plan-step__status">{STATUS_LABEL[step.status]}</span>
          {hasDetails && (
            <span className="plan-step__expand" aria-hidden="true">
              {expanded ? '▾' : '▸'}
            </span>
          )}
        </span>
      </button>
      {expanded && hasDetails && (
        <div className="plan-step__details">
          {step.objective && <p className="plan-step__objective">{step.objective}</p>}
          {step.tools && step.tools.length > 0 && (
            <p className="plan-step__detail-line">
              <span className="plan-step__detail-label">Tools</span>
              {step.tools.join(', ')}
            </p>
          )}
          {step.successCriteria && step.successCriteria.length > 0 && (
            <ul className="plan-step__criteria">
              {step.successCriteria.map((criterion) => (
                <li key={criterion}>{criterion}</li>
              ))}
            </ul>
          )}
          {step.dependsOn && step.dependsOn.length > 0 && (
            <p className="plan-step__detail-line">
              <span className="plan-step__detail-label">Depends on</span>
              {step.dependsOn.join(', ')}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export function PlanPanel({ plan, mode = 'plan', loading = false, liveStatus = null }: PlanPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [autoCollapsedSignature, setAutoCollapsedSignature] = useState<string | null>(null);
  const hasSteps = Boolean(plan && plan.steps.length > 0);
  const isPlanningSession = Boolean(plan?.status === 'planning' || (loading && !hasSteps));
  const showPanel = Boolean(plan && (hasSteps || isPlanningSession || plan.requirementAnalysis));
  const collapseLabel = collapsed ? 'View plan' : 'Hide plan';
  const planningLabel = liveStatus?.label?.toLowerCase().includes('plan')
    ? liveStatus.label
    : 'Building plan…';

  useEffect(() => {
    if (!plan || isPlanningSession || !plan.steps.length) return;
    const signature = `${plan.goal}:${plan.steps.length}`;
    if (autoCollapsedSignature === signature) return;
    setCollapsed(true);
    setAutoCollapsedSignature(signature);
  }, [autoCollapsedSignature, isPlanningSession, plan]);

  if (!showPanel) return null;

  if (!plan) return null;

  const done = plan.steps.filter((step) => step.status === 'done').length;
  const running = plan.steps.find((step) => step.status === 'running');
  const runningIndex = running ? plan.steps.findIndex((step) => step.id === running.id) : -1;
  const isPlanComplete = hasSteps && done === plan.steps.length;
  const plannerState = isPlanningSession
    ? 'Planning'
    : isPlanComplete || plan.status === 'completed'
      ? 'Plan done'
      : plan.status === 'ready'
        ? 'Plan ready'
        : 'Planner';

  const stepStats = liveStatus?.stepCurrent && liveStatus.stepTotal
    ? `${liveStatus.stepCurrent}/${liveStatus.stepTotal}`
    : undefined;
  const activeStatusText = isPlanningSession
    ? `${planningLabel}${liveStatus?.detail ? ` - ${liveStatus.detail}` : ''}`
    : running && loading
      ? `Step ${runningIndex + 1}/${plan.steps.length}: ${running.title}`
      : isPlanComplete
        ? 'All plan steps done'
        : undefined;
  const showHeaderSpinner = Boolean(isPlanningSession || (running && loading));

  const progressPct = hasSteps
    ? Math.round((done / plan.steps.length) * 100)
    : liveStatus?.stepCurrent && liveStatus.stepTotal
      ? Math.round((liveStatus.stepCurrent / liveStatus.stepTotal) * 100)
      : undefined;
  const showProgressBar = isPlanningSession
    ? progressPct !== undefined
    : hasSteps && !isPlanComplete;

  return (
    <section
      className={`plan-panel ${isPlanningSession ? 'plan-panel--planning' : ''} ${isPlanComplete ? 'plan-panel--done' : ''} ${mode === 'plan' ? 'plan-panel--plan-mode' : ''} ${collapsed ? 'plan-panel--collapsed' : ''}`}
      aria-label="Planner"
      aria-busy={isPlanningSession}
    >
      <button
        type="button"
        className="plan-panel__toggle plan-panel__toggle--header"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
        aria-label={`${collapseLabel} planner`}
        title={`${collapseLabel} planner`}
      >
        <span className="plan-panel__chevron" aria-hidden="true">
          {collapsed ? '▸' : '▾'}
        </span>
        <div className="plan-panel__header">
          <div className="plan-panel__headline">
            <h2>Plan</h2>
            {plan.goal && <p className="plan-panel__goal">{plan.goal}</p>}
            {isPlanningSession && (
              <p className="plan-panel__running" role="status">
                <span className="plan-panel__spinner plan-panel__spinner--inline" aria-hidden="true" />
                <span className="plan-panel__running-text">
                  {activeStatusText}
                </span>
                {stepStats && <span className="plan-panel__running-stat">{stepStats}</span>}
              </p>
            )}
            {running && loading && !isPlanningSession && (
              <p className="plan-panel__running">
                <span className="plan-panel__spinner plan-panel__spinner--inline" aria-hidden="true" />
                <span className="plan-panel__running-text">
                  Step {runningIndex + 1}/{plan.steps.length}: {running.title}
                </span>
              </p>
            )}
            {isPlanComplete && (
              <p className="plan-panel__running plan-panel__running--done">All plan steps done.</p>
            )}
          </div>
          <span className="plan-panel__meta">
            {collapsed && showHeaderSpinner && (
              <span className="plan-panel__spinner plan-panel__spinner--meta" aria-hidden="true" />
            )}
            <span className="plan-panel__state">{plannerState}</span>
            {hasSteps && (
              <span className="plan-panel__progress">{done}/{plan.steps.length}</span>
            )}
            <span className="plan-panel__collapse-label">{collapseLabel}</span>
          </span>
        </div>
      </button>
      {showProgressBar && (
        <div className="plan-panel__progress-track" aria-hidden="true">
          <div className="plan-panel__progress-fill" style={{ width: `${Math.min(100, Math.max(4, progressPct ?? 0))}%` }} />
        </div>
      )}

      {!collapsed && (
        <div className="plan-panel__content">
          {plan.appliedSkills && plan.appliedSkills.length > 0 && (
            <div className="plan-panel__skills" aria-label="Applied planning skills">
              {plan.appliedSkills.map((skill) => (
                <span key={skill} className="plan-panel__skill-chip">
                  {skill}
                </span>
              ))}
            </div>
          )}

          {plan.requirementAnalysis && (
            <details className="plan-panel__section" open={isPlanningSession}>
              <summary className="plan-panel__section-title">Requirement analysis</summary>
              <div className="plan-panel__analysis">{plan.requirementAnalysis}</div>
            </details>
          )}

          {plan.assumptions.length > 0 && (
            <details className="plan-panel__section" open>
              <summary className="plan-panel__section-title">Assumptions</summary>
              <ul className="plan-panel__assumptions">
                {plan.assumptions.map((assumption, index) => (
                  <li key={`${index}-${assumption}`}>{assumption}</li>
                ))}
              </ul>
            </details>
          )}

          {plan.requiredApprovals && plan.requiredApprovals.length > 0 && (
            <details className="plan-panel__section" open>
              <summary className="plan-panel__section-title">Required approvals</summary>
              <ul className="plan-panel__assumptions">
                {plan.requiredApprovals.map((approval, index) => (
                  <li key={`${index}-${approval}`}>{approval}</li>
                ))}
              </ul>
            </details>
          )}

          {hasSteps ? (
            <ol className="plan-panel__steps">
              {plan.steps.map((step, index) => (
                <PlanStepRow key={step.id} step={step} index={index} />
              ))}
            </ol>
          ) : isPlanningSession ? (
            <ol className="plan-panel__pipeline" aria-label="Planning pipeline">
              <li className={`plan-pipeline__item ${plan.requirementAnalysis ? 'plan-pipeline__item--done' : 'plan-pipeline__item--active'}`}>
                Requirement analysis
              </li>
              <li className={`plan-pipeline__item ${planningLabel.toLowerCase().includes('discovery') ? 'plan-pipeline__item--active' : ''}`}>
                Discovery
              </li>
              <li className={`plan-pipeline__item ${planningLabel.toLowerCase().includes('creating') ? 'plan-pipeline__item--active' : ''}`}>
                Compile plan
              </li>
            </ol>
          ) : null}
        </div>
      )}
    </section>
  );
}
