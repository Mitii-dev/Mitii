import type { CSSProperties } from 'react';
import { useState } from 'react';

import { modeColor } from '../modeColors';
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

const STATUS_LABELS: Record<PlanView['steps'][number]['status'], string> = {
  active: 'Running',
  done: 'Done',
  pending: 'Queued',
  skipped: 'Skipped',
};

function currentPlanStep(
  plan: PlanView | null,
  running = false,
): CurrentPlanStep | null {
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

  const nextIndex = steps.findIndex(
    (step) => step.status !== 'done' && step.status !== 'skipped',
  );
  if (nextIndex >= 0) {
    return {
      step: steps[nextIndex]!,
      index: nextIndex,
      total: steps.length,
      complete: false,
    };
  }

  let doneIndex = -1;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (steps[index]?.status === 'done') {
      doneIndex = index;
      break;
    }
  }
  if (doneIndex >= 0) {
    return {
      step: steps[doneIndex]!,
      index: doneIndex,
      total: steps.length,
      complete: steps.every((step) => step.status === 'done'),
    };
  }

  return null;
}

export function PlanFollowStrip({
  plan,
  running = false,
  onOpenPlanFile,
}: PlanFollowStripProps) {
  const [expanded, setExpanded] = useState(false);
  const current = currentPlanStep(plan, running);
  if (!plan) return null;

  const totalSteps = plan.steps.length;
  const completedSteps = plan.steps.filter(
    (step) => step.status === 'done',
  ).length;
  const statusText = current?.complete ? 'Done' : running ? 'Running' : 'Ready';
  const showLoader = running && !current?.complete;
  const headingText = current?.complete ? 'Plan complete' : 'Following plan';
  const fallbackTitle = plan.objective || plan.title;
  const currentIsRunning =
    current &&
    !current.complete &&
    (current.step.status === 'active' ||
      (running &&
        current.step.status !== 'done' &&
        current.step.status !== 'skipped'));
  const activeStepId = currentIsRunning ? current.step.id : null;
  const style = {
    '--plan-follow-accent': modeColor('plan'),
  } as CSSProperties;

  return (
    <section
      className="plan-follow"
      aria-label="Current plan step"
      style={style}
    >
      <div className="plan-follow__top">
        <div className="plan-follow__heading">
          <span className="plan-follow__eyebrow">{headingText}</span>
          <span className="plan-follow__progress">
            {completedSteps}/{totalSteps} complete
          </span>
        </div>
        <div className="plan-follow__actions">
          <button
            type="button"
            className="plan-follow__toggle"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
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
      </div>
      <div className="plan-follow__step">
        {current ? (
          <span className="plan-follow__count">
            Step {current.index + 1} of {current.total}
          </span>
        ) : (
          <span className="plan-follow__count">
            {totalSteps} step{totalSteps === 1 ? '' : 's'}
          </span>
        )}
        <span className="plan-follow__title">
          {current ? current.step.title : fallbackTitle}
        </span>
        <span
          className={`plan-follow__state plan-follow__state--${current?.complete ? 'done' : 'following'}`}
        >
          {statusText}
        </span>
        {showLoader ? <span className="plan-follow__loader" aria-hidden /> : null}
      </div>
      {expanded ? (
        <ol className="plan-follow__steps">
          {plan.steps.map((step, index) => (
            <li
              key={step.id}
              className={`plan-follow__steps-item plan-follow__steps-item--${
                activeStepId === step.id ? 'active' : step.status
              }`}
              aria-current={activeStepId === step.id ? 'step' : undefined}
            >
              <span className="plan-follow__steps-index">{index + 1}</span>
              <span className="plan-follow__steps-title">{step.title}</span>
              <span className="plan-follow__steps-status">
                {activeStepId === step.id
                  ? 'Running'
                  : STATUS_LABELS[step.status]}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
