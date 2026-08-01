import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhooksRepository } from './webhooks.repository';

/** Wires the Webhooks controller/service/repository together for the app module. */
export class WebhooksModule {
  readonly repository = new WebhooksRepository();
  readonly service = new WebhooksService(this.repository);
  readonly controller = new WebhooksController(this.service);
}
