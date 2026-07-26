import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductsRepository } from './products.repository';

/** Wires the Products controller/service/repository together for the app module. */
export class ProductsModule {
  readonly repository = new ProductsRepository();
  readonly service = new ProductsService(this.repository);
  readonly controller = new ProductsController(this.service);
}
