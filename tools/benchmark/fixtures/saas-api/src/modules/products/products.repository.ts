import type { Product } from './products.service';

/** In-memory-style persistence layer for Product rows. Swap for a real DB client in production. */
export class ProductsRepository {
  private rows = new Map<string, Product>();

  async insert(data: Partial<Product>): Promise<Product> {
    const id = `products_${this.rows.size + 1}`;
    const row = { id, ...data } as Product;
    this.rows.set(id, row);
    return row;
  }

  async findById(id: string): Promise<Product | undefined> {
    return this.rows.get(id);
  }

  async findAll(): Promise<Product[]> {
    return Array.from(this.rows.values());
  }

  async update(id: string, patch: Partial<Product>): Promise<Product> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`Product ${id} not found`);
    const updated = { ...existing, ...patch };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}
