import type { Cart } from './cart.service';

/** In-memory-style persistence layer for Cart rows. Swap for a real DB client in production. */
export class CartRepository {
  private rows = new Map<string, Cart>();

  async insert(data: Partial<Cart>): Promise<Cart> {
    const id = `cart_${this.rows.size + 1}`;
    const row = { id, ...data } as Cart;
    this.rows.set(id, row);
    return row;
  }

  async findById(id: string): Promise<Cart | undefined> {
    return this.rows.get(id);
  }

  async findAll(): Promise<Cart[]> {
    return Array.from(this.rows.values());
  }

  async update(id: string, patch: Partial<Cart>): Promise<Cart> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`Cart ${id} not found`);
    const updated = { ...existing, ...patch };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}
