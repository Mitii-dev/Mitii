/**
 * WIRING.md — App.tsx
 * - import { PlanFollowStrip } from './PlanFollowStrip.js'
 * - Mount above composer when an active / pending plan has steps:
 *   <PlanFollowStrip plan={followPlan} running={busy} onOpenPlanFile={openPath} />
 * - Derive `plan` from session pendingPlan / live run plan (flat steps or
 *   flatten PlanArtifact phases → steps with status).
 */

import { useState, type CSSProperties } from 'react';

export type PlanFollowStepStatus =
  | 'pending'
  | 'active'
  | 'done'
  | 'skipped'
  | string;

export interface PlanFollowStep {
  id: string;
  title: string;
  status: PlanFollowStepStatus;
  detail?: string;
}

export interface PlanFollowView {
  objective?: string;
  title?: string;
  steps?: PlanFollowStep[];
  savedPlanPath?: string;
}

export interface PlanFollowStripProps {
  plan: PlanFollowView | null;
  running?: boolean;
  onOpenPlanFile?: (path: string) => void;
}

interface CurrentPlanStep {
  step: PlanFollowStep;
  index: number;
  total: number;
  complete: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Running',
  done: 'Done',
  pending: 'Queued',
  skipped: 'Skipped',
};

function currentPlanStep(
  plan: PlanFollowView | null,
  _running = false,
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
  const [expanded, setExpanded] = useState(true);
  const current = currentPlanStep(plan, running);
  if (!plan) return null;

  const steps = plan.steps ?? [];
  const totalSteps = steps.length;
  const completedSteps = steps.filter((step) => step.status === 'done').length;
  const statusText = current?.complete ? 'Done' : running ? 'Running' : 'Ready';
  const showLoader = running && !current?.complete;
  const headingText = current?.complete
    ? 'Plan complete'
    : running
      ? 'Following plan'
      : 'Plan ready';
  const fallbackTitle = plan.objective || plan.title || 'Plan';
  const currentIsRunning =
    current &&
    !current.complete &&
    (current.step.status === 'active' ||
      (running &&
        current.step.status !== 'done' &&
        current.step.status !== 'skipped'));
  const activeStepId = currentIsRunning ? current.step.id : null;

  return (
    <section
      className="plan-follow-strip"
      aria-label="Current plan step"
      style={{ '--plan-follow-accent': '#f59e0b' } as CSSProperties}
    >
      <div className="plan-follow-strip__top">
        <div className="plan-follow-strip__heading">
          <span className="plan-follow-strip__eyebrow">{headingText}</span>
          <span className="plan-follow-strip__progress">
            {completedSteps}/{totalSteps} complete
          </span>
        </div>
        <div className="plan-follow-strip__actions">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
          {plan.savedPlanPath && onOpenPlanFile ? (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => onOpenPlanFile(plan.savedPlanPath!)}
              title={`Open ${plan.savedPlanPath}`}
            >
              Location
            </button>
          ) : null}
        </div>
      </div>
      <div className="plan-follow-strip__step">
        {current ? (
          <span className="plan-follow-strip__count">
            Step {current.index + 1} of {current.total}
          </span>
        ) : (
          <span className="plan-follow-strip__count">
            {totalSteps} step{totalSteps === 1 ? '' : 's'}
          </span>
        )}
        <span className="plan-follow-strip__title">
          {current ? current.step.title : fallbackTitle}
        </span>
        <span
          className={`plan-follow-strip__state plan-follow-strip__state--${current?.complete ? 'done' : 'following'}`}
        >
          {statusText}
        </span>
        {showLoader ? (
          <span className="plan-follow-strip__loader" aria-hidden />
        ) : null}
      </div>
      {expanded && steps.length > 0 ? (
        <ol className="plan-follow-strip__steps">
          {steps.map((step, index) => (
            <li
              key={step.id}
              className={`plan-follow-strip__steps-item plan-follow-strip__steps-item--${
                activeStepId === step.id ? 'active' : step.status
              }`}
              aria-current={activeStepId === step.id ? 'step' : undefined}
            >
              <span className="plan-follow-strip__steps-index">{index + 1}</span>
              <span className="plan-follow-strip__steps-title">{step.title}</span>
              <span className="plan-follow-strip__steps-status">
                {activeStepId === step.id
                  ? 'Running'
                  : (STATUS_LABELS[step.status] ?? step.status)}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
