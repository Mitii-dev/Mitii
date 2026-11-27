import { describe, expect, it } from 'vitest';

import { extractSuspension } from '../src/shared/suspension.js';

describe('extractSuspension', () => {
  it('passes clarifyOrigin for hollow_plan clarifications', () => {
    const suspension = extractSuspension({
      status: 'suspended',
      runId: 'run-1',
      suspension: {
        kind: 'clarification_required',
        rationale: 'Runtime shell suspended for host decision.',
        clarificationPrompt: 'Plan needed before building.',
        clarifyOrigin: 'hollow_plan',
      },
    });
    expect(suspension).toMatchObject({
      runId: 'run-1',
      kind: 'clarification_required',
      clarifyOrigin: 'hollow_plan',
      clarificationPrompt: 'Plan needed before building.',
    });
  });

  it('extracts plan steps for plan_approval_required', () => {
    const suspension = extractSuspension({
      status: 'suspended',
      runId: 'run-2',
      suspension: {
        kind: 'plan_approval_required',
        rationale: 'Runtime shell suspended for plan approval.',
        plan: {
          objective: 'Ship the wedding site',
          phases: [
            {
              name: 'Setup',
              steps: [
                {
                  id: 's1',
                  intent: 'Scaffold pages',
                  actionSummary: 'Create routes',
                },
              ],
            },
          ],
        },
      },
    });
    expect(suspension?.plan).toMatchObject({
      objective: 'Ship the wedding site',
      steps: [
        {
          id: 's1',
          title: 'Setup: Scaffold pages',
          detail: 'Create routes',
        },
      ],
    });
  });
});
