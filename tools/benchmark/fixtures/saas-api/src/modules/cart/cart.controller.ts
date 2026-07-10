import { CartService } from './cart.service';
import type { AddCartItemDto } from './dto/add-cart-item.dto';

/** HTTP entry points for the Cart module, mounted at /cart. */
export class CartController {
  constructor(private readonly cartService: CartService) {}

  async create(req: { body: AddCartItemDto }) {
    return this.cartService.create(req.body);
  }

  async findOne(req: { params: { id: string } }) {
    return this.cartService.findById(req.params.id);
  }

  async findAll() {
    return this.cartService.list();
  }

  async mergeGuestCartRoute(req: { params: { id?: string }; body: unknown }) {
    return this.cartService.mergeGuestCart(req.params.id as string, req.body as never);
  }

  async checkoutCartRoute(req: { params: { id?: string }; body: unknown }) {
    return this.cartService.checkoutCart(req.params.id as string, req.body as never);
  }
}
