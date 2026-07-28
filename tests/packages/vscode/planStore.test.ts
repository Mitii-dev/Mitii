import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PLANNING_SCHEMA_VERSION } from '@mitii/sdk';

import {
  buildPlanFileBaseName,
  savePlanToWorkspace,
} from '../../../apps/vscode/src/planStore.ts';

function samplePlan(objective = 'Ship plan persistence') {
  return {
    schemaVersion: PLANNING_SCHEMA_VERSION,
    objective,
    assumptions: [],
    openQuestions: [],
    contextReviewed: [],
    constraints: [],
    dimensions: {
      scope: 'module',
      risk: 'low' as const,
      clarity: 'clear',
      complexity: 'simple',
      changeImpact: ['code' as const],
    },
    phases: [
      {
        id: 'phase-1',
        name: 'Persist',
        purpose: 'Write plans to disk',
        steps: [
          {
            id: 'step-1',
            intent: 'Save JSON',
            targetRefs: ['.mitii/plans'],
            actionSummary: 'Write timestamped plan file',
            expectedOutcome: 'File exists',
            riskLevel: 'low' as const,
          },
        ],
        dependencies: [],
        successCriteria: [],
      },
    ],
    risks: [],
    alternatives: [],
    verification: { checks: [], manualQa: [], commands: [] },
    approvalRequired: false,
    processHintsApplied: [],
  };
}

describe('planStore', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('builds a timestamped slug basename', () => {
    const now = new Date('2026-07-27T19:49:05.000Z');
    const base = buildPlanFileBaseName({
      plan: samplePlan('Wire Conversation Carry!!'),
      now,
    });
    expect(base).toBe('20260727-194905-wire-conversation-carry');
  });

  it('saves JSON + markdown under .mitii/plans', () => {
    const root = mkdtempSync(join(tmpdir(), 'mitii-plan-store-'));
    dirs.push(root);
    const now = new Date('2026-07-27T19:49:05Z');

    const saved = savePlanToWorkspace({
      workspaceRoot: root,
      plan: samplePlan(),
      source: 'plan_mode',
      threadId: 'thread_1',
      now,
    });

    expect(saved.relativePath).toBe(
      join('.mitii', 'plans', '20260727-194905-ship-plan-persistence.json'),
    );
    const json = JSON.parse(readFileSync(saved.absolutePath, 'utf8')) as {
      schemaVersion: number;
      source: string;
      plan: { objective: string };
    };
    expect(json.schemaVersion).toBe(1);
    expect(json.source).toBe('plan_mode');
    expect(json.plan.objective).toBe('Ship plan persistence');

    const md = readFileSync(saved.markdownPath, 'utf8');
    expect(md).toContain('# Ship plan persistence');
    expect(md).toContain('Objective: Ship plan persistence');
  });
});
