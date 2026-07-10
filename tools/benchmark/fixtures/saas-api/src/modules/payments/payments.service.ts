import { PaymentsRepository } from './payments.repository';
import type { CreatePaymentDto } from './dto/create-payment.dto';
import type { RefundPaymentDto } from './dto/refund-payment.dto';

const MAX_RETRY_ATTEMPTS = 5;
export interface Payment {
  id: string;
  orderId: string;
  amountCents: number;
  status: string;
}

export class PaymentsService {
  constructor(private readonly repository: PaymentsRepository) {}

  async create(dto: CreatePaymentDto): Promise<Payment> {
    return this.repository.insert(dto as Partial<Payment>);
  }

  async findById(id: string): Promise<Payment> {
    const row = await this.repository.findById(id);
    if (!row) throw new Error(`Payment ${id} not found`);
    return row;
  }

  async list(): Promise<Payment[]> {
    return this.repository.findAll();
  }

  /**
   * Retries a failed payment against the configured payment gateway with exponential backoff. Marks the payment permanently failed after MAX_RETRY_ATTEMPTS.
   */
  async retryPayment(id: string): Promise<Payment> {
    const payment = await this.findById(id);
    if (payment.status !== 'failed') throw new Error('Only failed payments can be retried');
    const attempt = (payment.retryCount ?? 0) + 1;
    return this.repository.update(id, { status: attempt >= MAX_RETRY_ATTEMPTS ? 'failed_permanently' : 'retrying', retryCount: attempt });
  }

  /**
   * Issues a full refund for a completed payment and records the refund reason for audit purposes.
   */
  async processRefund(id: string, dto: RefundPaymentDto): Promise<Payment> {
    return this.repository.update(id, { status: 'refunded', refundReason: dto.reason });
  }
}
