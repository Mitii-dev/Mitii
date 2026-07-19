import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { ThunderController } from '../src/adapters/vscode/ThunderController';
import { PlanPersistence } from '../src/features/ce/plans/PlanPersistence';
import { ThunderSession } from '../src/features/ce/session/ThunderSession';

describe('session recovery', () => {
  const fixturePlanPath = () => join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures/session-recovery/active-plan.json');

  it('creates ThunderSession instances for restored chat thread ids', async () => {
    const session = new ThunderSession('/repo', 'agent', {
      id: 'ollama-thread-1',
      title: 'Ollama plan',
      createdAt: 100,
      updatedAt: 200,
    });

    expect(session.id).toBe('ollama-thread-1');
    expect(session.workspace).toBe('/repo');
    expect(session.mode).toBe('agent');
    expect(session.title).toBe('Ollama plan');
    expect(session.createdAt).toBe(100);
    expect(session.updatedAt).toBe(200);
  });

  it('rehydrates the active plan when a history thread is restored', async () => {
    const plan = JSON.parse(readFileSync(fixturePlanPath(), 'utf8'));
    const ensured: string[] = [];
    const notified: unknown[] = [];
    const controller = Object.create(ThunderController.prototype) as any;

    controller.session = undefined;
    controller.currentPlan = null;
    controller.agentActivity = [{ id: 'old', kind: 'info', message: 'old activity', timestamp: Date.now() }];
    controller.lastSubagentSnapshot = new Map([['old', 'running']]);
    controller.resolveWorkspacePath = () => '';
    controller.notifyUi = (partial: unknown) => notified.push(partial);
    controller.sessionService = {
      ensureSession: vi.fn((session: { id: string }) => ensured.push(session.id)),
    };
    controller.planPersistence = {
      getActive: vi.fn((sessionId: string) => sessionId === 'ollama-thread-1'
        ? { id: 'plan-1', plan, status: 'running' }
        : null),
    };

    const restored = controller.restoreChatSession('ollama-thread-1', { mode: 'agent' });

    expect(restored).toEqual(plan);
    expect(controller.getSession()?.id).toBe('ollama-thread-1');
    expect(controller.getSession()?.mode).toBe('agent');
    expect(ensured).toEqual(['ollama-thread-1']);
    expect(controller.currentPlan).toEqual(plan);
    expect(controller.agentActivity).toEqual([]);
    expect(controller.lastSubagentSnapshot?.size).toBe(0);
    expect(notified).toContainEqual(expect.objectContaining({
      currentSessionId: 'ollama-thread-1',
      plan,
      agentActivity: [],
      agentLiveStatus: null,
    }));
  });

  it('keeps active plans addressable by the original restored session id', async () => {
    const plan = JSON.parse(readFileSync(fixturePlanPath(), 'utf8'));
    const rows = new Map<string, { id: string; session_id: string; plan_json: string; status: string; updated_at: number }>();
    const db = {
      tryRaw: () => ({
        prepare: (sql: string) => ({
          get: (sessionId: string) => {
            if (!sql.includes('SELECT id, plan_json, status FROM task_plans')) return undefined;
            return [...rows.values()]
              .filter((row) => row.session_id === sessionId && ['active', 'running'].includes(row.status))
              .sort((a, b) => b.updated_at - a.updated_at)[0];
          },
          run: (...args: unknown[]) => {
            if (sql.includes('INSERT INTO task_plans')) {
              const [id, sessionId, , status, planJson, , updatedAt] = args as [string, string, string, string, string, number, number];
              rows.set(id, { id, session_id: sessionId, plan_json: planJson, status, updated_at: updatedAt });
            }
          },
        }),
      }),
    };
    const persistence = new PlanPersistence(db as never);

    persistence.save('ollama-thread-1', plan, 'running');

    expect(persistence.getActive('new-session-after-reload')).toBeNull();
    expect(persistence.getActive('ollama-thread-1')).toEqual({
      id: expect.any(String),
      plan,
      status: 'running',
    });
  });
});
