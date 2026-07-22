import { randomUUID } from 'crypto';
import type { ThunderDb } from '../../../features/ce/indexing/ThunderDb';
import type { ThunderPlan } from './PlanActEngine';
import { createLogger } from '../../../kernel/telemetry/Logger';

const log = createLogger('PlanPersistence');

export type PlanUpdateResult =
  | { ok: true; id: string; revision: number }
  | { ok: false; reason: 'db_unavailable' | 'not_found' | 'revision_conflict'; currentRevision?: number };

export interface ActivePlanRecord {
  id: string;
  plan: ThunderPlan;
  status: string;
  revision: number;
}

const ACTIVE_STATUSES = "('active', 'running', 'blocked')";

export class PlanPersistence {
  constructor(private readonly db: ThunderDb) {}

  save(sessionId: string, plan: ThunderPlan, status = 'active'): PlanUpdateResult {
    const db = this.db.tryRaw();
    if (!db) {
      return { ok: false, reason: 'db_unavailable' };
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.getActiveRow(db, sessionId);
      const id = existing?.id ?? randomUUID();
      const revision = (existing?.revision ?? 0) + 1;
      const now = Date.now();

      if (existing) {
        const updated = db
          .prepare(`
            UPDATE task_plans
            SET goal = ?, status = ?, plan_json = ?, updated_at = ?, revision = ?
            WHERE id = ? AND revision = ?
          `)
          .run(plan.goal, status, JSON.stringify(plan), now, revision, id, existing.revision);
        if (updated.changes !== 1) {
          db.exec('ROLLBACK');
          return { ok: false, reason: 'revision_conflict', currentRevision: existing.revision };
        }
      } else {
        db.prepare(`
          INSERT INTO task_plans (id, session_id, goal, status, plan_json, created_at, updated_at, revision)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, sessionId, plan.goal, status, JSON.stringify(plan), now, now, revision);
      }

      db.exec('COMMIT');
      log.info('Plan saved', { id, steps: plan.steps.length, revision });
      return { ok: true, id, revision };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  updatePlan(
    sessionId: string,
    plan: ThunderPlan,
    status?: string,
    expectedRevision?: number
  ): PlanUpdateResult {
    const db = this.db.tryRaw();
    if (!db) {
      return { ok: false, reason: 'db_unavailable' };
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      const active = this.getActiveRow(db, sessionId);
      if (!active) {
        db.exec('ROLLBACK');
        const created = this.save(sessionId, plan, status ?? 'active');
        return created;
      }

      if (expectedRevision !== undefined && active.revision !== expectedRevision) {
        db.exec('ROLLBACK');
        return { ok: false, reason: 'revision_conflict', currentRevision: active.revision };
      }

      const nextRevision = active.revision + 1;
      const updated = db
        .prepare(`
          UPDATE task_plans
          SET plan_json = ?, status = COALESCE(?, status), updated_at = ?, revision = ?
          WHERE id = ? AND revision = ?
        `)
        .run(JSON.stringify(plan), status ?? null, Date.now(), nextRevision, active.id, active.revision);

      if (updated.changes !== 1) {
        db.exec('ROLLBACK');
        return { ok: false, reason: 'revision_conflict', currentRevision: active.revision };
      }

      db.exec('COMMIT');
      return { ok: true, id: active.id, revision: nextRevision };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  getActive(sessionId: string): ActivePlanRecord | null {
    const db = this.db.tryRaw();
    if (!db) return null;

    const row = this.getActiveRow(db, sessionId);
    if (!row) return null;
    return {
      id: row.id,
      plan: JSON.parse(row.plan_json) as ThunderPlan,
      status: row.status,
      revision: row.revision,
    };
  }

  complete(sessionId: string, expectedRevision?: number): PlanUpdateResult {
    const db = this.db.tryRaw();
    if (!db) {
      return { ok: false, reason: 'db_unavailable' };
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      const active = this.getActiveRow(db, sessionId);
      if (!active) {
        db.exec('ROLLBACK');
        return { ok: false, reason: 'not_found' };
      }

      if (expectedRevision !== undefined && active.revision !== expectedRevision) {
        db.exec('ROLLBACK');
        return { ok: false, reason: 'revision_conflict', currentRevision: active.revision };
      }

      const nextRevision = active.revision + 1;
      const updated = db
        .prepare(`
          UPDATE task_plans
          SET status = 'completed', updated_at = ?, revision = ?
          WHERE id = ? AND revision = ?
        `)
        .run(Date.now(), nextRevision, active.id, active.revision);

      if (updated.changes !== 1) {
        db.exec('ROLLBACK');
        return { ok: false, reason: 'revision_conflict', currentRevision: active.revision };
      }

      db.exec('COMMIT');
      return { ok: true, id: active.id, revision: nextRevision };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  private getActiveRow(
    db: NonNullable<ReturnType<ThunderDb['tryRaw']>>,
    sessionId: string
  ): { id: string; plan_json: string; status: string; revision: number } | undefined {
    const row = db
      .prepare(`
        SELECT id, plan_json, status, revision FROM task_plans
        WHERE session_id = ? AND status IN ${ACTIVE_STATUSES}
        ORDER BY updated_at DESC LIMIT 1
      `)
      .get(sessionId) as { id: string; plan_json: string; status: string; revision?: number } | undefined;

    if (!row) return undefined;
    return {
      id: row.id,
      plan_json: row.plan_json,
      status: row.status,
      revision: typeof row.revision === 'number' ? row.revision : 0,
    };
  }
}
