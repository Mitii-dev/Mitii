import type { WebhookEndpoint } from './webhooks.service';

/** In-memory-style persistence layer for WebhookEndpoint rows. Swap for a real DB client in production. */
export class WebhooksRepository {
  private rows = new Map<string, WebhookEndpoint>();

  async insert(data: Partial<WebhookEndpoint>): Promise<WebhookEndpoint> {
    const id = `webhooks_${this.rows.size + 1}`;
    const row = { id, ...data } as WebhookEndpoint;
    this.rows.set(id, row);
    return row;
  }

  async findById(id: string): Promise<WebhookEndpoint | undefined> {
    return this.rows.get(id);
  }

  async findAll(): Promise<WebhookEndpoint[]> {
    return Array.from(this.rows.values());
  }

  async update(id: string, patch: Partial<WebhookEndpoint>): Promise<WebhookEndpoint> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`WebhookEndpoint ${id} not found`);
    const updated = { ...existing, ...patch };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}
