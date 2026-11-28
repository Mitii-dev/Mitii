import { describe, expect, it } from 'vitest';

import { extractPlanFromRunResult } from '../src/shared/planFormat.js';

describe('extractPlanFromRunResult progress', () => {
  it('extracts progress, nextAction, and completedPlanStepIds', () => {
    const extracted = extractPlanFromRunResult({
      status: 'completed',
      taskList: {
        schemaVersion: 1,
        source: 'plan',
        items: [
          { id: 't1', title: 'HTTP', status: 'done' },
          { id: 't2', title: 'React', status: 'pending' },
        ],
      },
      completedPlanStepIds: ['s1'],
      progress: {
        planCompletedCount: 1,
        planTotalCount: 2,
        doneCount: 1,
        pendingCount: 1,
        nextTitle: 'React',
        openTitles: ['React'],
      },
      nextAction: {
        kind: 'continue_checklist',
        prompt: 'Continue with the next plan item: React',
      },
    });

    expect(extracted.taskList?.items).toHaveLength(2);
    expect(extracted.completedPlanStepIds).toEqual(['s1']);
    expect(extracted.progress?.pendingCount).toBe(1);
    expect(extracted.nextAction?.prompt).toContain('React');
  });
});
