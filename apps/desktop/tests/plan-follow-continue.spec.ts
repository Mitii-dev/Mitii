import { describe, expect, it } from 'vitest';

import {
  planFollowNeedsContinue,
  currentPlanStep,
} from '../src/renderer/chat/PlanFollowStrip.js';

describe('planFollowNeedsContinue', () => {
  const plan = {
    objective: 'HTTP + React',
    steps: [
      { id: '1', title: 'HTTP desugar', status: 'done' as const },
      { id: '2', title: 'Add React cases', status: 'pending' as const },
    ],
  };

  it('is true when idle with open steps', () => {
    expect(planFollowNeedsContinue(plan, false)).toBe(true);
    expect(currentPlanStep(plan)?.step.title).toBe('Add React cases');
  });

  it('is false while running', () => {
    expect(planFollowNeedsContinue(plan, true)).toBe(false);
  });

  it('is false when all done', () => {
    expect(
      planFollowNeedsContinue(
        {
          steps: [
            { id: '1', title: 'A', status: 'done' },
            { id: '2', title: 'B', status: 'done' },
          ],
        },
        false,
      ),
    ).toBe(false);
  });
});
