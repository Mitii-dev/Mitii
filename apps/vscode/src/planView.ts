import type { PlanArtifact } from '@mitii/sdk';

import type { PlanStepView, PlanView } from './protocol';

/**
 * Map a V8 PlanArtifact into the host PlanView DTO.
 */
export function planViewFromArtifact(
  plan: PlanArtifact | undefined | null,
): PlanView | null {
  if (!plan) return null;
  const steps: PlanStepView[] = [];
  for (const phase of plan.phases) {
    for (const step of phase.steps) {
      steps.push({
        id: step.id,
        title: `${phase.name}: ${step.intent}`,
        status: 'pending',
        detail: step.actionSummary,
      });
    }
  }
  if (steps.length === 0) {
    steps.push({
      id: 'objective',
      title: plan.objective,
      status: 'pending',
    });
  }
  return {
    title: plan.objective.slice(0, 120),
    steps: steps.slice(0, 24),
  };
}
