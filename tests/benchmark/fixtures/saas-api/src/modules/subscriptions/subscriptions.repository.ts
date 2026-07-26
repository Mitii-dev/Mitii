import type { Subscription } from './subscriptions.service';

/** In-memory-style persistence layer for Subscription rows. Swap for a real DB client in production. */
export class SubscriptionsRepository {
  private rows = new Map<string, Subscription>();

  async insert(data: Partial<Subscription>): Promise<Subscription> {
    const id = `subscriptions_${this.rows.size + 1}`;
    const row = { id, ...data } as Subscription;
    this.rows.set(id, row);
    return row;
  }

  async findById(id: string): Promise<Subscription | undefined> {
    return this.rows.get(id);
  }

  async findAll(): Promise<Subscription[]> {
    return Array.from(this.rows.values());
  }

  async update(id: string, patch: Partial<Subscription>): Promise<Subscription> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`Subscription ${id} not found`);
    const updated = { ...existing, ...patch };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}
