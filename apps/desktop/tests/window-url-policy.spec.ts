import { describe, expect, it } from 'vitest';

import {
  isAllowedEngineBaseUrl,
  isExternalBrowsableUrl,
  isLoopbackAppUrl,
} from '../src/shared/window-url-policy.js';

describe('window-url-policy', () => {
  it('allows only true loopback app URLs (no prefix tricks)', () => {
    expect(isLoopbackAppUrl('http://127.0.0.1:7788/health')).toBe(true);
    expect(isLoopbackAppUrl('http://localhost:7788/')).toBe(true);
    expect(isLoopbackAppUrl('http://localhost.evil.com/')).toBe(false);
    expect(isLoopbackAppUrl('http://localhost@evil.com/')).toBe(false);
    expect(isLoopbackAppUrl('file:///tmp/x')).toBe(false);
  });

  it('allowlists external browse schemes', () => {
    expect(isExternalBrowsableUrl('https://docs.mitii.dev')).toBe(true);
    expect(isExternalBrowsableUrl('mailto:hi@example.com')).toBe(true);
    expect(isExternalBrowsableUrl('file:///etc/passwd')).toBe(false);
    expect(isExternalBrowsableUrl('smb://share')).toBe(false);
  });

  it('rejects engine URLs with credentials or non-loopback hosts', () => {
    expect(isAllowedEngineBaseUrl('http://127.0.0.1:9')).toBe(true);
    expect(isAllowedEngineBaseUrl('http://user:pass@127.0.0.1:9')).toBe(false);
    expect(isAllowedEngineBaseUrl('http://192.168.1.2:9')).toBe(false);
  });
});
