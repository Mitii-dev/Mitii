import { isIP } from 'node:net';

/**
 * URL / host safety for outbound retrieval.
 *
 * Policy:
 * - Only http(s)
 * - Block obvious local/metadata hostnames for *content* fetches
 * - SearXNG and similar self-hosted search endpoints MAY target localhost
 *   via `assertHttpUrl` with `allowPrivate: true`
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
]);

export class UrlSafetyError extends Error {
  readonly code = 'URL_SAFETY' as const;
  constructor(message: string) {
    super(message);
    this.name = 'UrlSafetyError';
  }
}

function stripIpv6Brackets(host: string): string {
  const trimmed = host.replace(/\.+$/, '');
  return trimmed.startsWith('[') && trimmed.endsWith(']')
    ? trimmed.slice(1, -1)
    : trimmed;
}

/** True for localhost, link-local, private, and unique-local ranges. */
export function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = stripIpv6Brackets(hostname.trim().toLowerCase());
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;

  const ipVersion = isIP(host);
  if (ipVersion === 0) return false;

  // IPv4 private / loopback / link-local / CGNAT
  if (ipVersion === 4) {
    const parts = host.split('.').map((p) => Number(p));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }

  // IPv6: loopback, unique-local, link-local
  const normalized = host.toLowerCase();
  if (normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe80:')) return true;
  return false;
}

export function assertHttpUrl(
  url: string,
  options: { allowPrivate?: boolean; label?: string } = {},
): URL {
  const label = options.label ?? 'URL';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UrlSafetyError(`${label} is not a valid URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UrlSafetyError(
      `${label} must use http or https (got ${parsed.protocol}).`,
    );
  }
  if (!options.allowPrivate && isPrivateOrLocalHostname(parsed.hostname)) {
    throw new UrlSafetyError(
      `${label} points to a private or local network target, which is not allowed.`,
    );
  }
  return parsed;
}

export function assertPublicHttpUrl(url: string, label = 'URL'): URL {
  return assertHttpUrl(url, { allowPrivate: false, label });
}
