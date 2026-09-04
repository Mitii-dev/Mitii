import { describe, expect, it } from 'vitest';

import { createOptionalSearchPort } from './search.js';

describe('createOptionalSearchPort', () => {
  it('returns undefined when no API key is available', () => {
    expect(createOptionalSearchPort({ env: {} })).toBeUndefined();
  });

  it('uses BRAVE_API_KEY from env', () => {
    expect(
      createOptionalSearchPort({ env: { BRAVE_API_KEY: 'test-key' } }),
    ).toBeDefined();
  });

  it('prefers explicit apiKey override over env', () => {
    expect(
      createOptionalSearchPort({
        env: {},
        apiKey: 'override-key',
      }),
    ).toBeDefined();
  });
});
