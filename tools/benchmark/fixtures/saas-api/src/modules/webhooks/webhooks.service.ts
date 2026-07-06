import { WebhooksRepository } from './webhooks.repository';
import type { RegisterWebhookDto } from './dto/register-webhook.dto';
import type { WebhookEventDto } from './dto/webhook-event.dto';

export interface WebhookEndpoint {
  id: string;
  url: string;
  secret: string;
  events: string[];
}

export class WebhooksService {
  constructor(private readonly repository: WebhooksRepository) {}

  async create(dto: RegisterWebhookDto): Promise<WebhookEndpoint> {
    return this.repository.insert(dto as Partial<WebhookEndpoint>);
  }

  async findById(id: string): Promise<WebhookEndpoint> {
    const row = await this.repository.findById(id);
    if (!row) throw new Error(`WebhookEndpoint ${id} not found`);
    return row;
  }

  async list(): Promise<WebhookEndpoint[]> {
    return this.repository.findAll();
  }

  /**
   * Verifies an inbound webhook's HMAC-SHA256 signature against the endpoint's stored secret using a constant-time comparison to prevent timing attacks.
   */
  async verifySignature(rawBody: string, signatureHeader: string, secret: string): boolean {
    const expected = computeHmacSha256(rawBody, secret);
    return timingSafeEqual(expected, signatureHeader);
  }

  /**
   * Retries delivery of a webhook event that previously failed, using an exponential backoff schedule capped at MAX_DELIVERY_ATTEMPTS.
   */
  async retryDelivery(eventId: string): Promise<void> {
    const event = await this.repository.findEventById(eventId);
    await this.deliverWithBackoff(event);
  }
}
