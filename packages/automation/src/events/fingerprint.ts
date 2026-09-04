import { createHash } from 'node:crypto';

/**
 * Stable fingerprint for incident-style dedupe (logs, CI failures).
 * Prefer caller-supplied keys when available; otherwise hash core fields.
 */
export function buildEventDedupeKey(input: {
  eventType: string;
  source: string;
  subject?: string;
  eventId: string;
  fingerprintParts?: string[];
}): string {
  if (input.fingerprintParts && input.fingerprintParts.length > 0) {
    const joined = input.fingerprintParts
      .map((p) => p.trim())
      .filter(Boolean)
      .join('|');
    if (joined) {
      return createHash('sha256').update(joined).digest('hex').slice(0, 32);
    }
  }
  const subject = input.subject?.trim();
  return `${input.eventType}:${input.source}:${subject || input.eventId}`;
}
