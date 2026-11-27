import { describe, expect, it } from 'vitest';

import { resolvePlanApprovalAction } from '../src/renderer/chat/resolvePlanApprovalAction.js';

describe('resolvePlanApprovalAction', () => {
  it('resumes execute only in agent mode', () => {
    expect(resolvePlanApprovalAction('agent')).toBe('resume_execute');
  });

  it('keeps the plan without writing in plan/ask modes', () => {
    expect(resolvePlanApprovalAction('plan')).toBe('keep_plan_only');
    expect(resolvePlanApprovalAction('ask')).toBe('keep_plan_only');
    expect(resolvePlanApprovalAction('database')).toBe('keep_plan_only');
    expect(resolvePlanApprovalAction(undefined)).toBe('keep_plan_only');
  });
});
