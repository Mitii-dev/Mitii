import type { StockItem } from './inventory.service';

/** In-memory-style persistence layer for StockItem rows. Swap for a real DB client in production. */
export class InventoryRepository {
  private rows = new Map<string, StockItem>();

  async insert(data: Partial<StockItem>): Promise<StockItem> {
    const id = `inventory_${this.rows.size + 1}`;
    const row = { id, ...data } as StockItem;
    this.rows.set(id, row);
    return row;
  }

  async findById(id: string): Promise<StockItem | undefined> {
    return this.rows.get(id);
  }

  async findAll(): Promise<StockItem[]> {
    return Array.from(this.rows.values());
  }

  async update(id: string, patch: Partial<StockItem>): Promise<StockItem> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`StockItem ${id} not found`);
    const updated = { ...existing, ...patch };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}
