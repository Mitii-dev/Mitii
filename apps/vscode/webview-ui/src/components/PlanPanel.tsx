import type { PlanView } from '../protocol';

interface PlanPanelProps {
  plan: PlanView | null;
}

const STATUS_LABEL: Record<PlanView['steps'][number]['status'], string> = {
  pending: 'Pending',
  active: 'Active',
  done: 'Done',
  skipped: 'Skipped',
};

function statusGlyph(status: PlanView['steps'][number]['status']): string {
  switch (status) {
    case 'done':
      return '✓';
    case 'active':
      return '•';
    case 'skipped':
      return '–';
    default:
      return '';
  }
}

export function PlanPanel({ plan }: PlanPanelProps) {
  if (!plan || plan.steps.length === 0) return null;

  const done = plan.steps.filter((s) => s.status === 'done').length;

  return (
    <section className="plan-panel" aria-label="Plan">
      <div className="plan-panel__header">
        <h3 className="plan-panel__title">{plan.title || 'Plan'}</h3>
        <span className="plan-panel__progress">
          {done}/{plan.steps.length}
        </span>
      </div>
      <ol className="plan-panel__steps">
        {plan.steps.map((step, index) => (
          <li key={step.id} className={`plan-step plan-step--${step.status}`}>
            <span
              className={`plan-step__check plan-step__check--${step.status}`}
              aria-hidden="true"
            >
              {statusGlyph(step.status)}
            </span>
            <span className="plan-step__index">{index + 1}</span>
            <div className="plan-step__body">
              <span className="plan-step__title">{step.title}</span>
              {step.detail ? (
                <span className="plan-step__detail">{step.detail}</span>
              ) : null}
            </div>
            <span className="plan-step__status">{STATUS_LABEL[step.status]}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
