import { describe, expect, it } from 'vitest';

import {
  PLANNING_SCHEMA_VERSION,
  formatPlanAsMarkdown,
  promotePlainPlanText,
  resolvePlanDisplayText,
} from '../src/shared/planFormat.js';

function samplePlan() {
  return {
    schemaVersion: PLANNING_SCHEMA_VERSION,
    objective: 'Add platform session interface',
    assumptions: ['Existing Tablet stays'],
    openQuestions: [],
    contextReviewed: [],
    constraints: ['Common interface'],
    dimensions: {
      scope: 'multi_file',
      risk: 'low' as const,
      clarity: 'clear',
      complexity: 'simple',
      changeImpact: ['code' as const],
    },
    phases: [
      {
        id: 'phase-1',
        name: 'Change',
        purpose: 'Implement interface + platforms',
        dependencies: [],
        successCriteria: ['Interface compiles'],
        steps: [
          {
            id: 'step-1',
            intent: 'Extend BaseSession',
            targetRefs: ['test/shared/session/BaseSession.ts'],
            actionSummary: 'Add abstract methods',
            expectedOutcome: 'BaseSession is complete',
            riskLevel: 'low' as const,
          },
        ],
      },
    ],
    risks: [],
    alternatives: [],
    verification: { checks: ['tsc'], manualQa: [], commands: [] },
    approvalRequired: false,
    processHintsApplied: [],
  };
}

describe('formatPlanAsMarkdown', () => {
  it('renders headings and write targets', () => {
    const md = formatPlanAsMarkdown(samplePlan());
    expect(md).toContain('# Add platform session interface');
    expect(md).toContain('## Plan');
    expect(md).toContain('### 1. Change');
    expect(md).toContain('`test/shared/session/BaseSession.ts`');
  });
});

describe('promotePlainPlanText', () => {
  it('promotes Objective/Plan labels to markdown', () => {
    const md = promotePlainPlanText(
      [
        'Objective: Do the thing',
        'Scope: multi_file; Risk: low',
        'Plan:',
        '1. Change — Apply edits',
        '   1.1. Extend BaseSession: Add methods',
      ].join('\n'),
    );
    expect(md).toContain('# Do the thing');
    expect(md).toContain('## Plan');
    expect(md).toContain('### 1. Change — Apply edits');
  });
});

describe('resolvePlanDisplayText', () => {
  it('prefers structured plan over plain answer', () => {
    const md = resolvePlanDisplayText({
      answer: 'Objective: ignored',
      plan: samplePlan(),
    });
    expect(md).toContain('# Add platform session interface');
    expect(md).not.toContain('Objective: ignored');
  });
});
