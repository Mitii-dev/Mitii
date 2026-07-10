import { InventoryRepository } from './inventory.repository';
import type { AdjustStockDto } from './dto/adjust-stock.dto';
import type { ReserveStockDto } from './dto/reserve-stock.dto';

export interface StockItem {
  id: string;
  productId: string;
  quantityOnHand: number;
  quantityReserved: number;
}

export class InventoryService {
  constructor(private readonly repository: InventoryRepository) {}

  async create(dto: AdjustStockDto): Promise<StockItem> {
    return this.repository.insert(dto as Partial<StockItem>);
  }

  async findById(id: string): Promise<StockItem> {
    const row = await this.repository.findById(id);
    if (!row) throw new Error(`StockItem ${id} not found`);
    return row;
  }

  async list(): Promise<StockItem[]> {
    return this.repository.findAll();
  }

  /**
   * Reserves stock for an in-progress checkout so two concurrent carts cannot both claim the last unit. Reservations expire after RESERVATION_TTL_MINUTES.
   */
  async reserveStock(dto: ReserveStockDto): Promise<void> {
    await this.repository.incrementReserved(dto.productId, dto.quantity);
  }

  /**
   * Releases previously reserved stock back to available inventory, used when a cart expires or an order is cancelled.
   */
  async releaseStock(productId: string, quantity: number): Promise<void> {
    await this.repository.decrementReserved(productId, quantity);
  }
}
