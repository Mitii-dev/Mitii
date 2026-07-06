import type { User } from './auth.service';

/** In-memory-style persistence layer for User rows. Swap for a real DB client in production. */
export class AuthRepository {
  private rows = new Map<string, User>();

  async insert(data: Partial<User>): Promise<User> {
    const id = `auth_${this.rows.size + 1}`;
    const row = { id, ...data } as User;
    this.rows.set(id, row);
    return row;
  }

  async findById(id: string): Promise<User | undefined> {
    return this.rows.get(id);
  }

  async findAll(): Promise<User[]> {
    return Array.from(this.rows.values());
  }

  async update(id: string, patch: Partial<User>): Promise<User> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`User ${id} not found`);
    const updated = { ...existing, ...patch };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}
