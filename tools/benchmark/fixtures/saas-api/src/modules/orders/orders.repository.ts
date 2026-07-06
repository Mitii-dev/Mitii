import type { Order } from './orders.service';

/** In-memory-style persistence layer for Order rows. Swap for a real DB client in production. */
export class OrdersRepository {
  private rows = new Map<string, Order>();

  async insert(data: Partial<Order>): Promise<Order> {
    const id = `orders_${this.rows.size + 1}`;
    const row = { id, ...data } as Order;
    this.rows.set(id, row);
    return row;
  }

  async findById(id: string): Promise<Order | undefined> {
    return this.rows.get(id);
  }

  async findAll(): Promise<Order[]> {
    return Array.from(this.rows.values());
  }

  async update(id: string, patch: Partial<Order>): Promise<Order> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`Order ${id} not found`);
    const updated = { ...existing, ...patch };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}
