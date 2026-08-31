import type { DeliverySender } from './types.js';

/**
 * Outbound signed/plain webhook delivery (Phase 3).
 * Posts a JSON receipt; optional shared secret as Bearer token.
 */
export function createWebhookDeliverySender(options: {
  fetchImpl?: typeof fetch;
  defaultTimeoutMs?: number;
}): DeliverySender {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.defaultTimeoutMs ?? 15_000;
  return {
    async send(input) {
      if (input.adapter !== 'webhook') {
        return {
          ok: false,
          error: `webhook sender cannot handle adapter=${input.adapter}`,
        };
      }
      const url = input.target.target;
      const token =
        typeof input.target.metadata?.token === 'string'
          ? input.target.metadata.token
          : undefined;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            runId: input.runId,
            title: input.title,
            status: input.status,
            reportPath: input.reportPath ?? null,
            answer: input.answer ?? null,
            error: input.error ?? null,
            sentAt: new Date().toISOString(),
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          return {
            ok: false,
            error: `webhook HTTP ${response.status}`,
          };
        }
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
