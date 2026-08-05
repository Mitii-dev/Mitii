import type { PlanView } from '../protocol';

interface PlanFollowStripProps {
  plan: PlanView | null;
  running?: boolean;
  onOpenPlanFile?: (path: string) => void;
}

interface CurrentPlanStep {
  step: PlanView['steps'][number];
  index: number;
  total: number;
  complete: boolean;
}

function currentPlanStep(plan: PlanView | null): CurrentPlanStep | null {
  const steps = plan?.steps ?? [];
  if (steps.length === 0) return null;

  const activeIndex = steps.findIndex((step) => step.status === 'active');
  if (activeIndex >= 0) {
    return {
      step: steps[activeIndex]!,
      index: activeIndex,
      total: steps.length,
      complete: false,
    };
  }

  const pendingIndex = steps.findIndex((step) => step.status === 'pending');
  if (pendingIndex >= 0) {
    return {
      step: steps[pendingIndex]!,
      index: pendingIndex,
      total: steps.length,
      complete: false,
    };
  }

  let doneIndex = 0;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (steps[index]?.status === 'done') {
      doneIndex = index;
      break;
    }
  }
  return {
    step: steps[doneIndex]!,
    index: doneIndex,
    total: steps.length,
    complete: steps.every((step) => step.status === 'done'),
  };
}

export function PlanFollowStrip({
  plan,
  running = false,
  onOpenPlanFile,
}: PlanFollowStripProps) {
  const current = currentPlanStep(plan);
  if (!plan || !current) return null;

  const statusText = current.complete ? 'Done' : 'Following';
  const showLoader = running && !current.complete;

  return (
    <section className="plan-follow" aria-label="Current plan step">
      <div className="plan-follow__top">
        <span className="plan-follow__eyebrow">
          {current.complete ? 'Plan complete' : 'Following plan'}
        </span>
        {plan.savedPlanPath && onOpenPlanFile ? (
          <button
            type="button"
            className="plan-follow__location"
            onClick={() => onOpenPlanFile(plan.savedPlanPath!)}
            title={`Open ${plan.savedPlanPath}`}
          >
            Location
          </button>
        ) : null}
      </div>
      <div className="plan-follow__step">
        <span className="plan-follow__count">
          Step ({current.index + 1}/{current.total}):
        </span>
        <span className="plan-follow__title">{current.step.title}</span>
        <span
          className={`plan-follow__state plan-follow__state--${current.complete ? 'done' : 'following'}`}
        >
          {statusText}
        </span>
        {showLoader ? <span className="plan-follow__loader" aria-hidden /> : null}
      </div>
    </section>
  );
}
