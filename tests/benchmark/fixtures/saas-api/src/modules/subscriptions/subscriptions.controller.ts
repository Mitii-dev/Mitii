import { SubscriptionsService } from './subscriptions.service';
import type { CreateSubscriptionDto } from './dto/create-subscription.dto';

/** HTTP entry points for the Subscriptions module, mounted at /subscriptions. */
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  async create(req: { body: CreateSubscriptionDto }) {
    return this.subscriptionsService.create(req.body);
  }

  async findOne(req: { params: { id: string } }) {
    return this.subscriptionsService.findById(req.params.id);
  }

  async findAll() {
    return this.subscriptionsService.list();
  }

  async renewSubscriptionRoute(req: { params: { id?: string }; body: unknown }) {
    return this.subscriptionsService.renewSubscription(req.params.id as string, req.body as never);
  }

  async prorateUpgradeRoute(req: { params: { id?: string }; body: unknown }) {
    return this.subscriptionsService.prorateUpgrade(req.params.id as string, req.body as never);
  }
}
