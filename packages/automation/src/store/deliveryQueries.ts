import type Database from 'better-sqlite3';

import { nowIso } from '../paths.js';
import type {
  AutomationDeliveryRecord,
  DeliveryAdapter,
  DeliveryStatus,
} from '../delivery/types.js';
import { mapDelivery } from './rowMappers.js';

type SqliteDb = Database.Database;

export function insertDelivery(db: SqliteDb, input: {
  deliveryId: string;
  runId: string;
  adapter: DeliveryAdapter;
  targetJson: string;
}): AutomationDeliveryRecord {
  const now = nowIso();
  db
    .prepare(
      `INSERT INTO automation_deliveries (
        delivery_id, run_id, adapter, status, target_json, error, attempts,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'pending', ?, NULL, 0, ?, ?)`,
    )
    .run(
      input.deliveryId,
      input.runId,
      input.adapter,
      input.targetJson,
      now,
      now,
    );
  return getDelivery(db, input.deliveryId)!;
}

export function getDelivery(db: SqliteDb, deliveryId: string): AutomationDeliveryRecord | undefined {
  const row = db
    .prepare(`SELECT * FROM automation_deliveries WHERE delivery_id = ?`)
    .get(deliveryId) as Record<string, unknown> | undefined;
  return row ? mapDelivery(row) : undefined;
}

export function listDeliveries(db: SqliteDb, options: {
  status?: DeliveryStatus;
  runId?: string;
  limit?: number;
} = {}): AutomationDeliveryRecord[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.status) {
    clauses.push('status = ?');
    params.push(options.status);
  }
  if (options.runId) {
    clauses.push('run_id = ?');
    params.push(options.runId);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
  const rows = db
    .prepare(
      `SELECT * FROM automation_deliveries ${where} ORDER BY created_at ASC LIMIT ?`,
    )
    .all(...params, limit) as Record<string, unknown>[];
  return rows.map(mapDelivery);
}

export function updateDelivery(db: SqliteDb, input: {
  deliveryId: string;
  status: DeliveryStatus;
  error?: string | null;
  bumpAttempt?: boolean;
}): void {
  if (input.bumpAttempt) {
    db
      .prepare(
        `UPDATE automation_deliveries SET
          status = ?,
          error = ?,
          attempts = attempts + 1,
          updated_at = ?
         WHERE delivery_id = ?`,
      )
      .run(
        input.status,
        input.error ?? null,
        nowIso(),
        input.deliveryId,
      );
    return;
  }
  db
    .prepare(
      `UPDATE automation_deliveries SET
        status = ?,
        error = ?,
        updated_at = ?
       WHERE delivery_id = ?`,
    )
    .run(
      input.status,
      input.error ?? null,
      nowIso(),
      input.deliveryId,
    );
}
