import { CartRepository } from './cart.repository';
import type { AddCartItemDto } from './dto/add-cart-item.dto';
import type { RemoveCartItemDto } from './dto/remove-cart-item.dto';

export interface Cart {
  id: string;
  userId: string;
  items: string[];
  status: string;
}

export class CartService {
  constructor(private readonly repository: CartRepository) {}

  async create(dto: AddCartItemDto): Promise<Cart> {
    return this.repository.insert(dto as Partial<Cart>);
  }

  async findById(id: string): Promise<Cart> {
    const row = await this.repository.findById(id);
    if (!row) throw new Error(`Cart ${id} not found`);
    return row;
  }

  async list(): Promise<Cart[]> {
    return this.repository.findAll();
  }

  /**
   * Merges an anonymous guest cart into a newly-authenticated user's cart after login, combining line items and deduping quantities.
   */
  async mergeGuestCart(guestCartId: string, userId: string): Promise<Cart> {
    const guestCart = await this.repository.findById(guestCartId);
    return this.repository.mergeInto(userId, guestCart.items);
  }

  /**
   * Kicks off checkout for a cart by handing it to OrdersService.convertCartToOrder, then marks the cart as checked out.
   */
  async checkoutCart(cartId: string): Promise<{ orderId: string }> {
    const order = await this.ordersService.convertCartToOrder(cartId);
    await this.repository.update(cartId, { status: 'checked_out' });
    return { orderId: order.id };
  }
}
