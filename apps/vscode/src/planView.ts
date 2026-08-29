import type { PlanArtifact } from '@mitii/sdk';

import type {
  PlanPhaseView,
  PlanRiskView,
  PlanStepView,
  PlanView,
} from './protocol.js';

export interface PlanViewOptions {
  /** Workspace-relative path to the saved markdown plan. */
  savedPlanPath?: string;
  /** Live display status to apply while a run is executing or after it completes. */
  stepStatus?: 'pending' | 'activeFirst' | 'done';
}

type PlanPhase = PlanArtifact['phases'][number];
type PlanStep = PlanPhase['steps'][number];
type PlanRisk = PlanArtifact['risks'][number];

/**
 * Map a V8 PlanArtifact into the host PlanView DTO.
 */
export function planViewFromArtifact(
  plan: PlanArtifact | undefined | null,
  options: PlanViewOptions = {},
): PlanView | null {
  if (!plan) return null;

  const phases: PlanPhaseView[] = plan.phases
    .slice(0, 12)
    .map((phase: PlanPhase, phaseIndex: number) => ({
      id: phase.id,
      name: phase.name,
      purpose: phase.purpose,
      steps: phase.steps
        .slice(0, 20)
        .map((step: PlanStep, stepIndex: number) =>
          mapStep(
            phase.name,
            step,
            stepStatusFor(options.stepStatus, phaseIndex, stepIndex),
          ),
        ),
    }));

  const steps: PlanStepView[] = [];
  for (const phase of phases) {
    for (const step of phase.steps) {
      steps.push(step);
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

  const verificationParts = [
    ...plan.verification.checks,
    ...plan.verification.commands,
    ...plan.verification.manualQa,
  ].filter((part) => part.trim().length > 0);

  const risks: PlanRiskView[] = plan.risks
    .slice(0, 12)
    .map((risk: PlanRisk) => ({
      id: risk.id,
      summary: risk.summary,
      severity: risk.severity,
      mitigation: risk.mitigation,
    }));

  return {
    title: plan.objective.slice(0, 120),
    steps,
    objective: plan.objective,
    dimensions: {
      scope: plan.dimensions.scope,
      risk: plan.dimensions.risk,
      clarity: plan.dimensions.clarity,
      complexity: plan.dimensions.complexity,
    },
    phases,
    risks,
    openQuestions: plan.openQuestions.slice(0, 8),
    verificationSummary:
      verificationParts.length > 0
        ? verificationParts.slice(0, 6).join(' · ')
        : undefined,
    ...(options.savedPlanPath
      ? { savedPlanPath: options.savedPlanPath }
      : {}),
  };
}

function mapStep(
  phaseName: string,
  step: PlanStep,
  status: PlanStepView['status'] = 'pending',
): PlanStepView {
  return {
    id: step.id,
    title: `${phaseName}: ${step.intent}`,
    status,
    detail: step.actionSummary,
    riskLevel: step.riskLevel,
    targetRefs: step.targetRefs.slice(0, 8),
    expectedOutcome: step.expectedOutcome,
    verification: step.verification,
  };
}

function stepStatusFor(
  mode: PlanViewOptions['stepStatus'],
  phaseIndex: number,
  stepIndex: number,
): PlanStepView['status'] {
  if (mode === 'done') return 'done';
  if (mode === 'activeFirst' && phaseIndex === 0 && stepIndex === 0) {
    return 'active';
  }
  return 'pending';
}
