import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify GitHub webhook signatures (X-Hub-Signature-256).
 * Requires the raw request body bytes.
 */
export function verifyGitHubWebhookSignature(input: {
  rawBody: Buffer | string;
  signatureHeader: string | undefined;
  secret: string;
}): boolean {
  if (!input.secret || !input.signatureHeader) return false;
  const expected =
    'sha256=' +
    createHmac('sha256', input.secret)
      .update(
        typeof input.rawBody === 'string'
          ? Buffer.from(input.rawBody)
          : input.rawBody,
      )
      .digest('hex');
  const provided = input.signatureHeader.trim();
  if (expected.length !== provided.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(provided, 'utf8'),
    );
  } catch {
    return false;
  }
}
