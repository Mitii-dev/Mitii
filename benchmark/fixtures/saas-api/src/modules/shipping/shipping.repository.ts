import type { Shipment } from './shipping.service';

/** In-memory-style persistence layer for Shipment rows. Swap for a real DB client in production. */
export class ShippingRepository {
  private rows = new Map<string, Shipment>();

  async insert(data: Partial<Shipment>): Promise<Shipment> {
    const id = `shipping_${this.rows.size + 1}`;
    const row = { id, ...data } as Shipment;
    this.rows.set(id, row);
    return row;
  }

  async findById(id: string): Promise<Shipment | undefined> {
    return this.rows.get(id);
  }

  async findAll(): Promise<Shipment[]> {
    return Array.from(this.rows.values());
  }

  async update(id: string, patch: Partial<Shipment>): Promise<Shipment> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`Shipment ${id} not found`);
    const updated = { ...existing, ...patch };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}
