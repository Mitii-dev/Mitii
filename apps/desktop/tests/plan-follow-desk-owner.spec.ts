import { describe, expect, it } from 'vitest';

import { planArtifactToFollowView } from '../src/renderer/chat/planFollowView.js';

describe('planArtifactToFollowView desk owner', () => {
  it('prefers sealed taskList titles over plan phase steps', () => {
    const view = planArtifactToFollowView(
      {
        objective: 'Campaign',
        phases: [
          {
            name: 'Phase',
            steps: [
              { id: 'p1', intent: 'Plan title A' },
              { id: 'p2', intent: 'Plan title B' },
            ],
          },
        ],
      },
      false,
      {
        schemaVersion: 1,
        source: 'agent',
        purpose: 'execution',
        title: 'Campaign checklist',
        items: [
          { id: 'slice_1', title: 'Desk title A', status: 'done' },
          { id: 'slice_2', title: 'Desk title B', status: 'pending' },
        ],
      },
    );
    expect(view?.steps?.map((step) => step.title)).toEqual([
      'Desk title A',
      'Desk title B',
    ]);
  });
});
