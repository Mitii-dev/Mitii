import { PaymentsService } from './payments.service';
import type { CreatePaymentDto } from './dto/create-payment.dto';

/** HTTP entry points for the Payments module, mounted at /payments. */
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  async create(req: { body: CreatePaymentDto }) {
    return this.paymentsService.create(req.body);
  }

  async findOne(req: { params: { id: string } }) {
    return this.paymentsService.findById(req.params.id);
  }

  async findAll() {
    return this.paymentsService.list();
  }

  async retryPaymentRoute(req: { params: { id?: string }; body: unknown }) {
    return this.paymentsService.retryPayment(req.params.id as string, req.body as never);
  }

  async processRefundRoute(req: { params: { id?: string }; body: unknown }) {
    return this.paymentsService.processRefund(req.params.id as string, req.body as never);
  }
}
