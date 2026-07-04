import { createHmac } from 'crypto';
import type { SessionLogEvent } from './SessionLogService';
import { createLogger } from './Logger';

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
    this.queue = this.queue
      .then(() => this.postWithRetry(payload))
      .catch((error) => {
        log.warn('Webhook delivery failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  private async postWithRetry(payload: string): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        await this.post(payload);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < this.maxRetries) {
          await sleep(250 * (attempt + 1));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async post(payload: string): Promise<void> {
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
    } finally {
      clearTimeout(timer);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
