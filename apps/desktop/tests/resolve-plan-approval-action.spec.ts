import { describe, expect, it } from 'vitest';

import { resolvePlanApprovalAction } from '../src/renderer/chat/resolvePlanApprovalAction.js';

describe('resolvePlanApprovalAction', () => {
  it('always resumes execute so Build implements from any mode', () => {
    expect(resolvePlanApprovalAction('agent')).toBe('resume_execute');
    expect(resolvePlanApprovalAction('plan')).toBe('resume_execute');
    expect(resolvePlanApprovalAction('ask')).toBe('resume_execute');
    expect(resolvePlanApprovalAction('database')).toBe('resume_execute');
    expect(resolvePlanApprovalAction(undefined)).toBe('resume_execute');
  });
});
