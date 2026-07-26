import type { AdminAction } from './admin.service';

/** In-memory-style persistence layer for AdminAction rows. Swap for a real DB client in production. */
export class AdminRepository {
  private rows = new Map<string, AdminAction>();

  async insert(data: Partial<AdminAction>): Promise<AdminAction> {
    const id = `admin_${this.rows.size + 1}`;
    const row = { id, ...data } as AdminAction;
    this.rows.set(id, row);
    return row;
  }

  async findById(id: string): Promise<AdminAction | undefined> {
    return this.rows.get(id);
  }

  async findAll(): Promise<AdminAction[]> {
    return Array.from(this.rows.values());
  }

  async update(id: string, patch: Partial<AdminAction>): Promise<AdminAction> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`AdminAction ${id} not found`);
    const updated = { ...existing, ...patch };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}
