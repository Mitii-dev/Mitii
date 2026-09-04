import { newId } from '../paths.js';
import type { SqliteAutomationStore } from '../store/sqliteStore.js';
import type {
  AutomationDeliveryRecord,
  DeliveryAdapter,
  DeliverySender,
  DeliveryTarget,
} from './types.js';
import { deliveryTargetSchema } from './types.js';

export interface DeliveryBusOptions {
  store: SqliteAutomationStore;
  sender?: DeliverySender;
  maxAttempts?: number;
}

/**
 * Phase 3 delivery bus: enqueue after runs, flush pending with retries.
 * Sender is injected by host/CLI (connect adapters / webhook / gh).
 */
export class DeliveryBus {
  private readonly store: SqliteAutomationStore;
  private readonly sender?: DeliverySender;
  private readonly maxAttempts: number;

  constructor(options: DeliveryBusOptions) {
    this.store = options.store;
    this.sender = options.sender;
    this.maxAttempts = options.maxAttempts ?? 5;
  }

  enqueueForRun(input: {
    runId: string;
    targets: DeliveryTarget[];
  }): AutomationDeliveryRecord[] {
    const created: AutomationDeliveryRecord[] = [];
    for (const raw of input.targets) {
      const target = deliveryTargetSchema.parse(raw);
      const record = this.store.insertDelivery({
        deliveryId: newId('dlv'),
        runId: input.runId,
        adapter: target.adapter,
        targetJson: JSON.stringify(target),
      });
      created.push(record);
    }
    return created;
  }

  /**
   * Parse delivery targets from a spec's metadata_json
   * (`{ "delivery": [ { adapter, target } ] }`).
   */
  static targetsFromMetadataJson(
    metadataJson: string | null | undefined,
  ): DeliveryTarget[] {
    if (!metadataJson?.trim()) return [];
    try {
      const parsed = JSON.parse(metadataJson) as {
        delivery?: unknown;
      };
      if (!Array.isArray(parsed.delivery)) return [];
      return parsed.delivery
        .map((item) => {
          const result = deliveryTargetSchema.safeParse(item);
          return result.success ? result.data : null;
        })
        .filter((t): t is DeliveryTarget => t !== null);
    } catch {
      return [];
    }
  }

  async flushPending(limit = 20): Promise<{
    sent: number;
    failed: number;
    skipped: number;
  }> {
    if (!this.sender) {
      return { sent: 0, failed: 0, skipped: 0 };
    }
    const pending = this.store.listDeliveries({
      status: 'pending',
      limit,
    });
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    for (const row of pending) {
      if (row.attempts >= this.maxAttempts) {
        this.store.updateDelivery({
          deliveryId: row.deliveryId,
          status: 'failed',
          error: `exceeded maxAttempts=${this.maxAttempts}`,
          bumpAttempt: false,
        });
        failed += 1;
        continue;
      }
      let target: DeliveryTarget;
      try {
        target = deliveryTargetSchema.parse(JSON.parse(row.targetJson));
      } catch (error) {
        this.store.updateDelivery({
          deliveryId: row.deliveryId,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          bumpAttempt: true,
        });
        failed += 1;
        continue;
      }
      const run = this.store.getRun(row.runId);
      const spec = run ? this.store.getSpec(run.specId) : undefined;
      if (!run || !spec) {
        skipped += 1;
        continue;
      }
      const result = await this.sender.send({
        adapter: target.adapter as DeliveryAdapter,
        target,
        runId: run.runId,
        title: spec.title,
        status: run.status,
        reportPath: run.reportPath,
        error: run.error,
      });
      if (result.ok) {
        this.store.updateDelivery({
          deliveryId: row.deliveryId,
          status: 'sent',
          error: null,
          bumpAttempt: true,
        });
        sent += 1;
      } else {
        const nextAttempts = row.attempts + 1;
        this.store.updateDelivery({
          deliveryId: row.deliveryId,
          status: nextAttempts >= this.maxAttempts ? 'failed' : 'pending',
          error: result.error,
          bumpAttempt: true,
        });
        if (nextAttempts >= this.maxAttempts) failed += 1;
        else skipped += 1;
      }
    }
    return { sent, failed, skipped };
  }
}
