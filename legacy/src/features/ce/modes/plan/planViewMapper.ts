import type { PlanPhase, ThunderPlan } from '../../plans/PlanActEngine';
import type { PlanPhaseView, PlanStepView, PlanView } from '../../../../vscode/webview/messages';

export function thunderPlanToView(
  plan: ThunderPlan,
  options?: {
    status?: PlanView['status'];
    requirementAnalysis?: string;
    appliedSkills?: string[];
    showInternalPhases?: boolean;
  }
): PlanView {
  const showInternalPhases = Boolean(options?.showInternalPhases);
  const steps = plan.steps.map((step) => thunderStepToView(step, showInternalPhases));
  const phases = showInternalPhases ? buildPhaseViews(plan) : [];

  return {
    goal: plan.goal,
    assumptions: plan.assumptions,
    requiredApprovals: plan.requiredApprovals,
    steps,
    phases: phases.length > 0 ? phases : undefined,
    status: options?.status ?? 'ready',
    requirementAnalysis: options?.requirementAnalysis,
    appliedSkills: options?.appliedSkills,
  };
}

function thunderStepToView(step: ThunderPlan['steps'][number], includeInternalPhase = false): PlanStepView {
  return {
    id: step.id,
    title: step.title,
    status: step.status,
    risk: step.risk,
    files: step.files,
    phase: includeInternalPhase ? step.phase : undefined,
    objective: step.objective,
    tools: step.tools,
    successCriteria: step.successCriteria,
    dependsOn: step.dependsOn,
  };
}

function buildPhaseViews(plan: ThunderPlan): PlanPhaseView[] {
  if (plan.phases?.length) {
    return plan.phases.map((phase, index) => ({
      id: phase.id ?? `phase-${index + 1}`,
      title: phase.title,
      phase: phase.phase,
      steps: (phase.steps ?? []).map((step) =>
        thunderStepToView({
          ...step,
          status: plan.steps.find((s) => s.id === step.id)?.status ?? 'pending',
          risk: step.risk ?? 'medium',
        } as ThunderPlan['steps'][number], true)
      ),
    }));
  }

  const byPhase = new Map<PlanPhase, PlanStepView[]>();
  for (const step of plan.steps) {
    const phase = step.phase ?? 'execute';
    const list = byPhase.get(phase) ?? [];
    list.push(thunderStepToView(step, true));
    byPhase.set(phase, list);
  }

  const order: PlanPhase[] = ['diagnostics', 'review', 'execute', 'verify'];
  const views: PlanPhaseView[] = [];
  for (const phase of order) {
    const steps = byPhase.get(phase);
    if (!steps?.length) continue;
    views.push({
      id: `phase-${phase}`,
      title: phaseTitle(phase),
      phase,
      steps,
    });
  }
  return views;
}

function phaseTitle(phase: PlanPhase): string {
  switch (phase) {
    case 'diagnostics':
      return 'Phase 1: Diagnostics';
    case 'review':
      return 'Phase 2: Review';
    case 'execute':
      return 'Phase 3: Execute';
    case 'verify':
      return 'Phase 4: Verify';
  }
}
