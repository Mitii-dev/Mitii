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

  it('keeps campaign plan phases visible during verification repair', () => {
    const view = planArtifactToFollowView(
      {
        objective: 'HTTP redesign',
        phases: [
          {
            name: 'Change',
            steps: [
              { id: 'p1', intent: 'Desugar nested http.start' },
              { id: 'p2', intent: 'Session continuity' },
              { id: 'p3', intent: 'Scaffold three React cases' },
            ],
          },
        ],
      },
      false,
      {
        schemaVersion: 1,
        source: 'agent',
        purpose: 'execution',
        title: 'Verification repair',
        items: [
          {
            id: 'repair_fix',
            title: 'Address verification failures',
            status: 'active',
          },
          {
            id: 'repair_reverify',
            title: 'Re-run verification for this change set',
            status: 'pending',
          },
        ],
      },
      new Set(['p1']),
    );
    expect(view?.steps?.map((step) => step.title)).toEqual([
      'Change: Desugar nested http.start',
      'Change: Session continuity',
      'Change: Scaffold three React cases',
    ]);
    expect(view?.steps?.[0]?.status).toBe('done');
  });

  it('returns null when plan has no structured steps (Build banner only)', () => {
    const view = planArtifactToFollowView(
      {
        objective: 'I need you to redesign how HTTP checks work…',
        phases: [{ name: 'Change', steps: [] }],
      },
      false,
      {
        schemaVersion: 1,
        source: 'agent',
        purpose: 'execution',
        title: 'Campaign checklist',
        items: [
          {
            id: 'slice_1',
            title: 'I need you to redesign how HTTP checks work…',
            status: 'active',
          },
        ],
      },
    );
    expect(view).toBeNull();
  });
});
