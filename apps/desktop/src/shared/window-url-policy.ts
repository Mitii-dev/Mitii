/**
 * URL classification for Electron window.open / shell.openExternal.
 * Uses URL parsing — never string prefixes.
 */

const LOOPBACK_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
]);

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/** True for http(s) URLs whose host is the loopback engine — may open in-app. */
export function isLoopbackAppUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      LOOPBACK_HOSTNAMES.has(url.hostname)
    );
  } catch {
    return false;
  }
}

/** True for URLs that may be handed to the OS via shell.openExternal. */
export function isExternalBrowsableUrl(rawUrl: string): boolean {
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(rawUrl).protocol);
  } catch {
    return false;
  }
}

/** Engine base URL must be loopback http(s) only. */
export function isAllowedEngineBaseUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (!LOOPBACK_HOSTNAMES.has(url.hostname)) return false;
    if (url.username || url.password) return false;
    return true;
  } catch {
    return false;
  }
}
