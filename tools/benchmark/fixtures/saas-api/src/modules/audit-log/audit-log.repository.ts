import type { AuditEntry } from './audit-log.service';

/** In-memory-style persistence layer for AuditEntry rows. Swap for a real DB client in production. */
export class AuditLogRepository {
  private rows = new Map<string, AuditEntry>();

  async insert(data: Partial<AuditEntry>): Promise<AuditEntry> {
    const id = `auditLog_${this.rows.size + 1}`;
    const row = { id, ...data } as AuditEntry;
    this.rows.set(id, row);
    return row;
  }

  async findById(id: string): Promise<AuditEntry | undefined> {
    return this.rows.get(id);
  }

  async findAll(): Promise<AuditEntry[]> {
    return Array.from(this.rows.values());
  }

  async update(id: string, patch: Partial<AuditEntry>): Promise<AuditEntry> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`AuditEntry ${id} not found`);
    const updated = { ...existing, ...patch };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}
