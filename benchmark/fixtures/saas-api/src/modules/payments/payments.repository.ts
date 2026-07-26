import type { Payment } from './payments.service';

/** In-memory-style persistence layer for Payment rows. Swap for a real DB client in production. */
export class PaymentsRepository {
  private rows = new Map<string, Payment>();

  async insert(data: Partial<Payment>): Promise<Payment> {
    const id = `payments_${this.rows.size + 1}`;
    const row = { id, ...data } as Payment;
    this.rows.set(id, row);
    return row;
  }

  async findById(id: string): Promise<Payment | undefined> {
    return this.rows.get(id);
  }

  async findAll(): Promise<Payment[]> {
    return Array.from(this.rows.values());
  }

  async update(id: string, patch: Partial<Payment>): Promise<Payment> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`Payment ${id} not found`);
    const updated = { ...existing, ...patch };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}
