import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersRepository } from './orders.repository';

/** Wires the Orders controller/service/repository together for the app module. */
export class OrdersModule {
  readonly repository = new OrdersRepository();
  readonly service = new OrdersService(this.repository);
  readonly controller = new OrdersController(this.service);
}
