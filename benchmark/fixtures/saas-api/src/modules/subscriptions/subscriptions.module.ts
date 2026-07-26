import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsRepository } from './subscriptions.repository';

/** Wires the Subscriptions controller/service/repository together for the app module. */
export class SubscriptionsModule {
  readonly repository = new SubscriptionsRepository();
  readonly service = new SubscriptionsService(this.repository);
  readonly controller = new SubscriptionsController(this.service);
}
