/** Map plan artifacts and task lists to the plan-follow strip view. */

import { type TaskList, type PlanArtifact } from '../../shared/planFormat.js';
import { type PlanFollowStepStatus, type PlanFollowView } from './PlanFollowStrip.js';

export function formatPlanFollowStepTitle(
  phaseName: string,
  intent: string,
  actionSummary?: string,
): string {
  const phase = phaseName.trim();
  const stepIntent = intent.trim();
  const summary = actionSummary?.trim() ?? '';
  // Hollow "Change: Change path" → prefer actionSummary / bare intent.
  if (/^change$/i.test(phase) && /^change\b/i.test(stepIntent)) {
    return summary || stepIntent;
  }
  if (phase && stepIntent) return `${phase}: ${stepIntent}`;
  return stepIntent || summary || phase || 'Step';
}

export function matchTaskForPlanStep(
  step: {
    id: string;
    intent: string;
    actionSummary?: string;
    targetRefs?: string[];
  },
  taskList: TaskList | null | undefined,
  completedPlanStepIds?: ReadonlySet<string>,
): TaskList['items'][number] | undefined {
  if (completedPlanStepIds?.has(step.id)) {
    return {
      id: step.id,
      title: step.intent,
      status: 'done',
    };
  }
  if (!taskList?.items.length) return undefined;
  const byRef = taskList.items.find(
    (item) => item.sourceRef === step.id || item.id === step.id,
  );
  if (byRef) return byRef;
  const refs = new Set(
    (step.targetRefs ?? []).map((path) => path.replace(/\\/g, '/').toLowerCase()),
  );
  if (refs.size > 0) {
    const byWrite = taskList.items.find((item) =>
      (item.write ?? []).some((path) =>
        refs.has(path.replace(/\\/g, '/').toLowerCase()),
      ),
    );
    if (byWrite) return byWrite;
  }
  const needle = (step.intent || step.actionSummary || '')
    .toLowerCase()
    .slice(0, 48);
  if (!needle) return undefined;
  return taskList.items.find((item) => {
    const hay = `${item.title} ${item.detail ?? ''}`.toLowerCase();
    return hay.includes(needle) || needle.includes(item.title.toLowerCase());
  });
}

export function planStepStatusFromTask(
  taskStatus: string | undefined,
): PlanFollowStepStatus {
  switch ((taskStatus ?? '').toLowerCase()) {
    case 'done':
    case 'completed':
      return 'done';
    case 'active':
    case 'in_progress':
    case 'running':
      return 'active';
    case 'skipped':
      return 'skipped';
    default:
      return 'pending';
  }
}

/** Follow strip from a durable execution checklist (no PlanArtifact needed). */
export function taskListToFollowView(
  taskList: TaskList | null | undefined,
): PlanFollowView | null {
  if (!taskList?.items?.length) return null;
  if (taskList.purpose === 'discovery' || taskList.source === 'discovery') {
    return null;
  }
  const steps = taskList.items.slice(0, 24).map((item) => ({
    id: item.id,
    title: item.title,
    status: planStepStatusFromTask(item.status),
    ...(item.detail ? { detail: item.detail } : {}),
  }));
  return {
    objective: taskList.title ?? 'Campaign checklist',
    title: (taskList.title ?? 'Campaign checklist').slice(0, 120),
    steps,
  };
}

export function planArtifactToFollowView(
  plan: PlanArtifact | null,
  running: boolean,
  taskList?: TaskList | null,
  completedPlanStepIds?: ReadonlySet<string>,
): PlanFollowView | null {
  // Cursor-like: sealed execution checklist owns progress titles/order.
  // Plan artifact only supplies statuses when the desk is empty.
  const deskView = taskListToFollowView(taskList);
  if (deskView) return deskView;
  if (!plan) return null;
  const steps: NonNullable<PlanFollowView['steps']> = [];
  for (const phase of plan.phases) {
    for (const step of phase.steps) {
      const matched = matchTaskForPlanStep(
        step,
        taskList,
        completedPlanStepIds,
      );
      steps.push({
        id: step.id,
        title: formatPlanFollowStepTitle(
          phase.name,
          step.intent,
          step.actionSummary,
        ),
        status: planStepStatusFromTask(matched?.status),
        detail: step.actionSummary,
      });
      if (steps.length >= 24) break;
    }
    if (steps.length >= 24) break;
  }
  if (steps.length === 0) {
    steps.push({
      id: 'objective',
      title: plan.objective,
      status: 'pending',
    });
  }
  // Only invent "step 1 active" when the task list has no active/done signal yet.
  const hasProgress = steps.some(
    (step) => step.status === 'active' || step.status === 'done',
  );
  if (running && !hasProgress && steps[0]) {
    steps[0] = { ...steps[0], status: 'active' };
  }
  return {
    objective: plan.objective,
    title: plan.objective.slice(0, 120),
    steps,
  };
}
