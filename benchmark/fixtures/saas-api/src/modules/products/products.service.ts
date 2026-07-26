import { ProductsRepository } from './products.repository';
import type { CreateProductDto } from './dto/create-product.dto';
import type { UpdateProductDto } from './dto/update-product.dto';

export interface Product {
  id: string;
  name: string;
  priceCents: number;
  sku: string;
}

export class ProductsService {
  constructor(private readonly repository: ProductsRepository) {}

  async create(dto: CreateProductDto): Promise<Product> {
    return this.repository.insert(dto as Partial<Product>);
  }

  async findById(id: string): Promise<Product> {
    const row = await this.repository.findById(id);
    if (!row) throw new Error(`Product ${id} not found`);
    return row;
  }

  async list(): Promise<Product[]> {
    return this.repository.findAll();
  }

  /**
   * Changes a product's price and writes a price-history row so past invoices keep referencing the price at time of purchase.
   */
  async adjustPrice(id: string, newPriceCents: number): Promise<Product> {
    await this.repository.recordPriceHistory(id, newPriceCents);
    return this.repository.update(id, { priceCents: newPriceCents });
  }

  /**
   * Marks a product as discontinued so it stops appearing in search and catalog listings, without deleting historical order references.
   */
  async discontinueProduct(id: string): Promise<Product> {
    return this.repository.update(id, { status: 'discontinued' });
  }
}
