import { createHmac } from 'crypto';
import type { SessionLogEvent } from '../../../kernel/telemetry/SessionLogService';
import { createLogger } from '../../../kernel/telemetry/Logger';
import { debugTrace } from '../../../kernel/telemetry/AsyncDebugTrace';

const log = createLogger('WebhookEmitter');

export interface WebhookEmitterConfig {
  url?: string;
  secret?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export class WebhookEmitter {
  private url = '';
  private secret = '';
  private timeoutMs = 5000;
  private maxRetries = 2;
  private queue: Promise<void> = Promise.resolve();

  configure(config: WebhookEmitterConfig): void {
    this.url = config.url?.trim() ?? '';
    this.secret = config.secret ?? '';
    this.timeoutMs = config.timeoutMs ?? 5000;
    this.maxRetries = config.maxRetries ?? 2;
  }

  isEnabled(): boolean {
    return Boolean(this.url);
  }

  emit(event: SessionLogEvent): void {
    if (!this.isEnabled()) return;
    const payload = JSON.stringify(event);
    const deliveryId = `${event.sessionId}:${event.ts}:${Math.random().toString(36).slice(2, 8)}`;
    debugTrace.trace('webhook', 'delivery_queued', {
      deliveryId,
      eventType: event.type,
      bytes: Buffer.byteLength(payload),
    }, event);
    this.queue = this.queue
      .then(() => this.postWithRetry(payload, deliveryId, event.type))
      .catch((error) => {
        log.warn('Webhook delivery failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  private async postWithRetry(payload: string, deliveryId: string, eventType: string): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const startedAt = Date.now();
      debugTrace.trace('webhook', 'request_send', {
        deliveryId,
        eventType,
        attempt: attempt + 1,
        bytes: Buffer.byteLength(payload),
      });
      try {
        const status = await this.post(payload);
        debugTrace.trace('webhook', 'response_receive', {
          deliveryId,
          eventType,
          attempt: attempt + 1,
          status,
          durationMs: Date.now() - startedAt,
        });
        return;
      } catch (error) {
        lastError = error;
        debugTrace.trace('webhook', 'request_error', {
          deliveryId,
          eventType,
          attempt: attempt + 1,
          durationMs: Date.now() - startedAt,
          willRetry: attempt < this.maxRetries,
          error: error instanceof Error ? error.message : String(error),
        });
        if (attempt < this.maxRetries) {
          await sleep(250 * (attempt + 1));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async post(payload: string): Promise<number> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'Mitii-AI-Agent',
      };
      if (this.secret) {
        headers['X-Mitii-Signature'] = `sha256=${createHmac('sha256', this.secret).update(payload).digest('hex')}`;
      }
      const response = await fetch(this.url, {
        method: 'POST',
        headers,
        body: payload,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Webhook returned ${response.status}`);
      }
      return response.status;
    } finally {
      clearTimeout(timer);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
