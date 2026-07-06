import { SubscriptionsRepository } from './subscriptions.repository';
import type { CreateSubscriptionDto } from './dto/create-subscription.dto';
import type { CancelSubscriptionDto } from './dto/cancel-subscription.dto';

const BILLING_PERIOD_DAYS = 5;
export interface Subscription {
  id: string;
  userId: string;
  planId: string;
  status: string;
}

export class SubscriptionsService {
  constructor(private readonly repository: SubscriptionsRepository) {}

  async create(dto: CreateSubscriptionDto): Promise<Subscription> {
    return this.repository.insert(dto as Partial<Subscription>);
  }

  async findById(id: string): Promise<Subscription> {
    const row = await this.repository.findById(id);
    if (!row) throw new Error(`Subscription ${id} not found`);
    return row;
  }

  async list(): Promise<Subscription[]> {
    return this.repository.findAll();
  }

  /**
   * Renews a subscription for another billing period, charging the stored payment method and extending currentPeriodEnd.
   */
  async renewSubscription(id: string): Promise<Subscription> {
    await this.paymentsService.retryPayment(id);
    return this.repository.extendPeriod(id, BILLING_PERIOD_DAYS);
  }

  /**
   * Calculates a prorated credit for the remaining days on the current plan when a user upgrades mid-cycle, then applies it to the new plan's first invoice.
   */
  async prorateUpgrade(id: string, newPlanId: string): Promise<Subscription> {
    const credit = this.repository.computeProrationCredit(id);
    return this.repository.update(id, { planId: newPlanId, creditCents: credit });
  }
}
