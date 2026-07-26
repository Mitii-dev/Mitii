import { ProductsService } from './products.service';
import type { CreateProductDto } from './dto/create-product.dto';

/** HTTP entry points for the Products module, mounted at /products. */
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  async create(req: { body: CreateProductDto }) {
    return this.productsService.create(req.body);
  }

  async findOne(req: { params: { id: string } }) {
    return this.productsService.findById(req.params.id);
  }

  async findAll() {
    return this.productsService.list();
  }

  async adjustPriceRoute(req: { params: { id?: string }; body: unknown }) {
    return this.productsService.adjustPrice(req.params.id as string, req.body as never);
  }

  async discontinueProductRoute(req: { params: { id?: string }; body: unknown }) {
    return this.productsService.discontinueProduct(req.params.id as string, req.body as never);
  }
}
