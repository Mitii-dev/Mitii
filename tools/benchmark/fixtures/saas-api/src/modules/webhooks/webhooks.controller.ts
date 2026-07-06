import { WebhooksService } from './webhooks.service';
import type { RegisterWebhookDto } from './dto/register-webhook.dto';

/** HTTP entry points for the Webhooks module, mounted at /webhooks. */
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  async create(req: { body: RegisterWebhookDto }) {
    return this.webhooksService.create(req.body);
  }

  async findOne(req: { params: { id: string } }) {
    return this.webhooksService.findById(req.params.id);
  }

  async findAll() {
    return this.webhooksService.list();
  }

  async verifySignatureRoute(req: { params: { id?: string }; body: unknown }) {
    return this.webhooksService.verifySignature(req.params.id as string, req.body as never);
  }

  async retryDeliveryRoute(req: { params: { id?: string }; body: unknown }) {
    return this.webhooksService.retryDelivery(req.params.id as string, req.body as never);
  }
}
