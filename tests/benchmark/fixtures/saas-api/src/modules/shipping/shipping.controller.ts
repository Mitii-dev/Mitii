import { ShippingService } from './shipping.service';
import type { CreateShipmentDto } from './dto/create-shipment.dto';

/** HTTP entry points for the Shipping module, mounted at /shipping. */
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  async create(req: { body: CreateShipmentDto }) {
    return this.shippingService.create(req.body);
  }

  async findOne(req: { params: { id: string } }) {
    return this.shippingService.findById(req.params.id);
  }

  async findAll() {
    return this.shippingService.list();
  }

  async calculateShippingRateRoute(req: { params: { id?: string }; body: unknown }) {
    return this.shippingService.calculateShippingRate(req.params.id as string, req.body as never);
  }

  async trackShipmentRoute(req: { params: { id?: string }; body: unknown }) {
    return this.shippingService.trackShipment(req.params.id as string, req.body as never);
  }
}
