import type { AnalyticsEvent } from './analytics.service';

/** In-memory-style persistence layer for AnalyticsEvent rows. Swap for a real DB client in production. */
export class AnalyticsRepository {
  private rows = new Map<string, AnalyticsEvent>();

  async insert(data: Partial<AnalyticsEvent>): Promise<AnalyticsEvent> {
    const id = `analytics_${this.rows.size + 1}`;
    const row = { id, ...data } as AnalyticsEvent;
    this.rows.set(id, row);
    return row;
  }

  async findById(id: string): Promise<AnalyticsEvent | undefined> {
    return this.rows.get(id);
  }

  async findAll(): Promise<AnalyticsEvent[]> {
    return Array.from(this.rows.values());
  }

  async update(id: string, patch: Partial<AnalyticsEvent>): Promise<AnalyticsEvent> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`AnalyticsEvent ${id} not found`);
    const updated = { ...existing, ...patch };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}
