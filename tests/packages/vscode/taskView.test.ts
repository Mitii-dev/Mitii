import { describe, expect, it } from 'vitest';

import { taskViewFromList } from '../../../apps/vscode/src/taskView.ts';

describe('taskViewFromList', () => {
  it('maps a live task list without inventing done statuses', () => {
    const view = taskViewFromList({
      schemaVersion: 1,
      source: 'plan',
      title: 'Ship SSO',
      items: [
        { id: 'one', title: 'Discover: Locate auth', status: 'pending' },
        { id: 'two', title: 'Change: Add provider', status: 'active' },
      ],
    });
    expect(view).not.toBeNull();
    expect(view!.items).toHaveLength(2);
    expect(view!.items[0]!.status).toBe('pending');
    expect(view!.items[1]!.status).toBe('active');
  });

  it('returns null for an empty list', () => {
    expect(
      taskViewFromList({
        schemaVersion: 1,
        source: 'agent',
        items: [],
      }),
    ).toBeNull();
  });
});
