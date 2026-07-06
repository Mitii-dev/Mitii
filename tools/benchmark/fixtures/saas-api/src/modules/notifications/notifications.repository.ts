import type { Notification } from './notifications.service';

/** In-memory-style persistence layer for Notification rows. Swap for a real DB client in production. */
export class NotificationsRepository {
  private rows = new Map<string, Notification>();

  async insert(data: Partial<Notification>): Promise<Notification> {
    const id = `notifications_${this.rows.size + 1}`;
    const row = { id, ...data } as Notification;
    this.rows.set(id, row);
    return row;
  }

  async findById(id: string): Promise<Notification | undefined> {
    return this.rows.get(id);
  }

  async findAll(): Promise<Notification[]> {
    return Array.from(this.rows.values());
  }

  async update(id: string, patch: Partial<Notification>): Promise<Notification> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`Notification ${id} not found`);
    const updated = { ...existing, ...patch };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}
