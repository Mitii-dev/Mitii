import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { CartRepository } from './cart.repository';

/** Wires the Cart controller/service/repository together for the app module. */
export class CartModule {
  readonly repository = new CartRepository();
  readonly service = new CartService(this.repository);
  readonly controller = new CartController(this.service);
}
