import { describe, expect, it } from 'vitest';

import {
  assertHttpUrl,
  assertPublicHttpUrl,
  isPrivateOrLocalHostname,
  UrlSafetyError,
} from './urlSafety.js';

describe('urlSafety', () => {
  it('detects private and local hostnames', () => {
    expect(isPrivateOrLocalHostname('localhost')).toBe(true);
    expect(isPrivateOrLocalHostname('127.0.0.1')).toBe(true);
    expect(isPrivateOrLocalHostname('10.0.0.1')).toBe(true);
    expect(isPrivateOrLocalHostname('192.168.1.1')).toBe(true);
    expect(isPrivateOrLocalHostname('172.16.5.1')).toBe(true);
    expect(isPrivateOrLocalHostname('::1')).toBe(true);
    expect(isPrivateOrLocalHostname('example.com')).toBe(false);
    expect(isPrivateOrLocalHostname('api.search.brave.com')).toBe(false);
  });

  it('allows private hosts only when opted in', () => {
    expect(() =>
      assertHttpUrl('http://127.0.0.1:8080/search', { allowPrivate: true }),
    ).not.toThrow();
    expect(() => assertPublicHttpUrl('http://127.0.0.1:8080/search')).toThrow(
      UrlSafetyError,
    );
  });

  it('rejects non-http schemes', () => {
    expect(() => assertPublicHttpUrl('file:///etc/passwd')).toThrow(
      UrlSafetyError,
    );
    expect(() => assertPublicHttpUrl('ftp://example.com')).toThrow(
      UrlSafetyError,
    );
  });
});
