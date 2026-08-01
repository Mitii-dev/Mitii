import { InventoryService } from './inventory.service';
import type { AdjustStockDto } from './dto/adjust-stock.dto';

/** HTTP entry points for the Inventory module, mounted at /inventory. */
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  async create(req: { body: AdjustStockDto }) {
    return this.inventoryService.create(req.body);
  }

  async findOne(req: { params: { id: string } }) {
    return this.inventoryService.findById(req.params.id);
  }

  async findAll() {
    return this.inventoryService.list();
  }

  async reserveStockRoute(req: { params: { id?: string }; body: unknown }) {
    return this.inventoryService.reserveStock(req.params.id as string, req.body as never);
  }

  async releaseStockRoute(req: { params: { id?: string }; body: unknown }) {
    return this.inventoryService.releaseStock(req.params.id as string, req.body as never);
  }
}
