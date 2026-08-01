import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { InventoryRepository } from './inventory.repository';

/** Wires the Inventory controller/service/repository together for the app module. */
export class InventoryModule {
  readonly repository = new InventoryRepository();
  readonly service = new InventoryService(this.repository);
  readonly controller = new InventoryController(this.service);
}
