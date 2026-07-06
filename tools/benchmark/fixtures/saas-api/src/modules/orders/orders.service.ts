import { OrdersRepository } from './orders.repository';
import type { CreateOrderDto } from './dto/create-order.dto';
import type { UpdateOrderStatusDto } from './dto/update-order-status.dto';

export interface Order {
  id: string;
  userId: string;
  status: string;
  totalCents: number;
}

export class OrdersService {
  constructor(private readonly repository: OrdersRepository) {}

  async create(dto: CreateOrderDto): Promise<Order> {
    return this.repository.insert(dto as Partial<Order>);
  }

  async findById(id: string): Promise<Order> {
    const row = await this.repository.findById(id);
    if (!row) throw new Error(`Order ${id} not found`);
    return row;
  }

  async list(): Promise<Order[]> {
    return this.repository.findAll();
  }

  /**
   * Converts a checked-out cart into an order: snapshots line-item prices, reserves inventory, and clears the cart. Called from CartService.checkoutCart.
   */
  async convertCartToOrder(cartId: string): Promise<Order> {
    const cart = await this.cartRepository.findById(cartId);
    const order = await this.repository.insert({ userId: cart.userId, status: 'pending', items: cart.items });
    await this.cartRepository.clear(cartId);
    return order;
  }

  /**
   * Cancels a pending order, releasing any reserved inventory back to stock and recording the cancellation reason.
   */
  async cancelOrder(id: string, reason: string): Promise<Order> {
    return this.repository.update(id, { status: 'cancelled', cancellationReason: reason });
  }
}
