import type { PlanView } from '../../../vscode/webview/messages';

interface PlanPanelProps {
  plan: PlanView | null;
}

const STATUS_LABEL: Record<PlanView['steps'][number]['status'], string> = {
  pending: 'Pending',
  running: 'Running',
  done: 'Done',
  blocked: 'Blocked',
  failed: 'Failed',
  blocked_by_dependency: 'Waiting',
};

export function PlanPanel({ plan }: PlanPanelProps) {
  if (!plan || plan.steps.length === 0) return null;

  const done = plan.steps.filter((step) => step.status === 'done').length;

  return (
    <section className="plan-panel" aria-label="Current plan">
      <div className="plan-panel__header">
        <div>
          <p className="plan-panel__eyebrow">Plan</p>
          <h2>{plan.goal}</h2>
        </div>
        <span className="plan-panel__progress">{done}/{plan.steps.length}</span>
      </div>
      <ol className="plan-panel__steps">
        {plan.steps.map((step, index) => (
          <li key={step.id} className={`plan-step plan-step--${step.status}`}>
            <span className="plan-step__index">{index + 1}</span>
            <span className="plan-step__title">{step.title}</span>
            <span className="plan-step__status">{STATUS_LABEL[step.status]}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
