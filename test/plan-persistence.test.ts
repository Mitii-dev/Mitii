import { describe, expect, it } from 'vitest';
import { PlanPersistence } from '../src/features/ce/plans/PlanPersistence';
import type { ThunderPlan } from '../src/features/ce/plans/PlanActEngine';

const samplePlan = (): ThunderPlan => ({
  goal: 'Test plan',
  assumptions: [],
  requiredApprovals: [],
  steps: [{ id: 'step_1', title: 'First', status: 'pending', risk: 'low' }],
});

function createMockDb() {
  type Row = {
    id: string;
    session_id: string;
    goal: string;
    status: string;
    plan_json: string;
    created_at: number;
    updated_at: number;
    revision: number;
  };
  const rows = new Map<string, Row>();

  return {
    rows,
    db: {
      exec: (sql: string) => {
        if (sql === 'BEGIN IMMEDIATE' || sql === 'COMMIT' || sql === 'ROLLBACK') return;
        throw new Error(`Unexpected exec: ${sql}`);
      },
      prepare: (sql: string) => ({
        get: (sessionId: string) => {
          if (!sql.includes('FROM task_plans')) return undefined;
          return [...rows.values()]
            .filter((row) => row.session_id === sessionId && ['active', 'running', 'blocked'].includes(row.status))
            .sort((a, b) => b.updated_at - a.updated_at)[0];
        },
        run: (...args: unknown[]) => {
          if (sql.includes('INSERT INTO task_plans')) {
            const [id, sessionId, goal, status, planJson, createdAt, updatedAt, revision] = args as [
              string,
              string,
              string,
              string,
              string,
              number,
              number,
              number,
            ];
            rows.set(id, {
              id,
              session_id: sessionId,
              goal,
              status,
              plan_json: planJson,
              created_at: createdAt,
              updated_at: updatedAt,
              revision,
            });
            return { changes: 1 };
          }

          if (sql.includes('UPDATE task_plans')) {
            const id = args[args.length - 2] as string;
            const expectedRevision = args[args.length - 1] as number;
            const row = rows.get(id);
            if (!row || row.revision !== expectedRevision) {
              return { changes: 0 };
            }

            if (sql.includes("status = 'completed'")) {
              const [updatedAt, nextRevision] = args as [number, number];
              row.updated_at = updatedAt;
              row.revision = nextRevision;
              row.status = 'completed';
              return { changes: 1 };
            }

            const planJson = args[0] as string;
            const status = args[1] as string | null;
            const updatedAt = args[2] as number;
            const nextRevision = args[3] as number;
            row.plan_json = planJson;
            row.updated_at = updatedAt;
            row.revision = nextRevision;
            if (status) row.status = status;
            return { changes: 1 };
          }

          return { changes: 0 };
        },
      }),
    },
  };
}

describe('PlanPersistence revision locking', () => {
  it('increments revision on save and update', () => {
    const { db, rows } = createMockDb();
    const persistence = new PlanPersistence({ tryRaw: () => db } as never);
    const plan = samplePlan();

    const saved = persistence.save('session-1', plan, 'running');
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.revision).toBe(1);

    plan.steps[0].status = 'running';
    const updated = persistence.updatePlan('session-1', plan, 'running', 1);
    expect(updated.ok).toBe(true);
    if (updated.ok) expect(updated.revision).toBe(2);

    const active = persistence.getActive('session-1');
    expect(active?.revision).toBe(2);
    expect(rows.size).toBe(1);
  });

  it('rejects stale revision updates', () => {
    const { db } = createMockDb();
    const persistence = new PlanPersistence({ tryRaw: () => db } as never);
    const plan = samplePlan();

    persistence.save('session-1', plan, 'running');
    const stale = persistence.updatePlan('session-1', plan, 'running', 0);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toBe('revision_conflict');
  });
});
