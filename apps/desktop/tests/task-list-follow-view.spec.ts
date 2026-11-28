import { describe, expect, it } from 'vitest';

import { taskListToFollowView } from '../src/renderer/chat/planFollowView.js';

describe('taskListToFollowView', () => {
  it('maps execution checklist into follow strip steps', () => {
    const view = taskListToFollowView({
      schemaVersion: 1,
      source: 'agent',
      purpose: 'execution',
      title: 'Campaign checklist',
      items: [
        { id: 's1', title: 'HTTP desugar', status: 'done' },
        { id: 's2', title: 'React cases', status: 'pending' },
      ],
    });
    expect(view?.steps).toHaveLength(2);
    expect(view?.steps?.[0]?.status).toBe('done');
    expect(view?.steps?.[1]?.status).toBe('pending');
    expect(view?.title).toContain('Campaign');
  });

  it('ignores discovery lists', () => {
    expect(
      taskListToFollowView({
        schemaVersion: 1,
        source: 'discovery',
        purpose: 'discovery',
        items: [{ id: 'a', title: 'Find entry', status: 'active' }],
      }),
    ).toBeNull();
  });
});
