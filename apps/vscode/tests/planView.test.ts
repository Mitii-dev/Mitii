import { describe, expect, it } from 'vitest';
import { PLANNING_SCHEMA_VERSION } from '@mitii/sdk';

import { planViewFromArtifact } from '../src/planView.ts';

function samplePlan() {
  return {
    schemaVersion: PLANNING_SCHEMA_VERSION,
    objective: 'Add SSO without breaking password login',
    assumptions: ['Password login remains'],
    openQuestions: ['Which OIDC provider?'],
    contextReviewed: [],
    constraints: ['Keep password login working'],
    dimensions: {
      scope: 'package',
      risk: 'high' as const,
      clarity: 'partially_clear',
      complexity: 'complex',
      changeImpact: ['code' as const, 'security' as const],
    },
    phases: [
      {
        id: 'phase-1',
        name: 'Discover',
        purpose: 'Map auth seams',
        steps: [
          {
            id: 'step-1',
            intent: 'Locate auth flow',
            targetRefs: ['src/auth'],
            actionSummary: 'Search and read auth module',
            expectedOutcome: 'Targets known',
            riskLevel: 'medium' as const,
            verification: 'List auth entrypoints',
          },
        ],
        dependencies: [],
        successCriteria: ['Targets identified'],
      },
    ],
    risks: [
      {
        id: 'risk-1',
        summary: 'Session regression',
        severity: 'high' as const,
        mitigation: 'Keep session store unchanged',
      },
    ],
    alternatives: [],
    verification: {
      checks: ['unit tests'],
      manualQa: ['Login smoke'],
      commands: ['pnpm test'],
    },
    rollback: 'Revert auth changes',
    approvalRequired: true,
    processHintsApplied: [],
  };
}

describe('planViewFromArtifact', () => {
  it('maps PlanArtifact into an enriched PlanView', () => {
    const view = planViewFromArtifact(samplePlan(), {
      savedPlanPath: '.mitii/plans/example.md',
    });

    expect(view).not.toBeNull();
    expect(view!.title).toContain('Add SSO');
    expect(view!.objective).toBe('Add SSO without breaking password login');
    expect(view!.dimensions).toEqual({
      scope: 'package',
      risk: 'high',
      clarity: 'partially_clear',
      complexity: 'complex',
    });
    expect(view!.phases).toHaveLength(1);
    expect(view!.phases![0]!.name).toBe('Discover');
    expect(view!.steps[0]!.title).toContain('Locate auth flow');
    expect(view!.steps[0]!.targetRefs).toEqual(['src/auth']);
    expect(view!.risks?.[0]?.summary).toBe('Session regression');
    expect(view!.openQuestions).toContain('Which OIDC provider?');
    expect(view!.verificationSummary).toContain('unit tests');
    expect(view!.savedPlanPath).toBe('.mitii/plans/example.md');
  });

  it('returns null for missing plans', () => {
    expect(planViewFromArtifact(undefined)).toBeNull();
    expect(planViewFromArtifact(null)).toBeNull();
  });

  it('can mark live and completed plan steps for the UI', () => {
    const live = planViewFromArtifact(samplePlan(), {
      stepStatus: 'activeFirst',
    });
    const done = planViewFromArtifact(samplePlan(), {
      stepStatus: 'done',
    });

    expect(live!.steps[0]!.status).toBe('active');
    expect(done!.steps[0]!.status).toBe('done');
  });
});
