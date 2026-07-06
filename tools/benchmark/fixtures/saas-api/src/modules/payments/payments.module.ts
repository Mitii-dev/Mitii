import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentsRepository } from './payments.repository';

/** Wires the Payments controller/service/repository together for the app module. */
export class PaymentsModule {
  readonly repository = new PaymentsRepository();
  readonly service = new PaymentsService(this.repository);
  readonly controller = new PaymentsController(this.service);
}
