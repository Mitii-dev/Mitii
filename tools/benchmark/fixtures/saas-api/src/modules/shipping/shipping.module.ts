import { ShippingController } from './shipping.controller';
import { ShippingService } from './shipping.service';
import { ShippingRepository } from './shipping.repository';

/** Wires the Shipping controller/service/repository together for the app module. */
export class ShippingModule {
  readonly repository = new ShippingRepository();
  readonly service = new ShippingService(this.repository);
  readonly controller = new ShippingController(this.service);
}
