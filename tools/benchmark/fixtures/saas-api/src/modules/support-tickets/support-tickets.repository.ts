import type { SupportTicket } from './support-tickets.service';

/** In-memory-style persistence layer for SupportTicket rows. Swap for a real DB client in production. */
export class SupportTicketsRepository {
  private rows = new Map<string, SupportTicket>();

  async insert(data: Partial<SupportTicket>): Promise<SupportTicket> {
    const id = `supportTickets_${this.rows.size + 1}`;
    const row = { id, ...data } as SupportTicket;
    this.rows.set(id, row);
    return row;
  }

  async findById(id: string): Promise<SupportTicket | undefined> {
    return this.rows.get(id);
  }

  async findAll(): Promise<SupportTicket[]> {
    return Array.from(this.rows.values());
  }

  async update(id: string, patch: Partial<SupportTicket>): Promise<SupportTicket> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`SupportTicket ${id} not found`);
    const updated = { ...existing, ...patch };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}
