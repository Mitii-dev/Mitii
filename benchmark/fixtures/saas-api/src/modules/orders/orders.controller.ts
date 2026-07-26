import { OrdersService } from './orders.service';
import type { CreateOrderDto } from './dto/create-order.dto';

/** HTTP entry points for the Orders module, mounted at /orders. */
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  async create(req: { body: CreateOrderDto }) {
    return this.ordersService.create(req.body);
  }

  async findOne(req: { params: { id: string } }) {
    return this.ordersService.findById(req.params.id);
  }

  async findAll() {
    return this.ordersService.list();
  }

  async convertCartToOrderRoute(req: { params: { id?: string }; body: unknown }) {
    return this.ordersService.convertCartToOrder(req.params.id as string, req.body as never);
  }

  async cancelOrderRoute(req: { params: { id?: string }; body: unknown }) {
    return this.ordersService.cancelOrder(req.params.id as string, req.body as never);
  }
}
