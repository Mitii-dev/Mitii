import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getProviderPreset } from '@mitii/host';

import {
  preferredApiKeyEnvName,
  upsertDotEnvKey,
} from '../src/setupEnvKeys.js';

describe('preferredApiKeyEnvName', () => {
  it('maps presets to the right env vars', () => {
    expect(preferredApiKeyEnvName(getProviderPreset('anthropic')!)).toBe(
      'ANTHROPIC_API_KEY',
    );
    expect(preferredApiKeyEnvName(getProviderPreset('gemini')!)).toBe(
      'GEMINI_API_KEY',
    );
    expect(preferredApiKeyEnvName(getProviderPreset('openai')!)).toBe(
      'OPENAI_API_KEY',
    );
    expect(preferredApiKeyEnvName(getProviderPreset('ollama-cloud')!)).toBe(
      'MITII_API_KEY',
    );
  });
});

describe('upsertDotEnvKey', () => {
  it('creates and updates .mitii/.env without duplicating keys', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-dotenv-'));
    try {
      const path = upsertDotEnvKey({
        cwd: dir,
        key: 'MITII_API_KEY',
        value: 'first',
      });
      expect(path).toBe(join(dir, '.mitii', '.env'));
      expect(readFileSync(path, 'utf8')).toMatch(/MITII_API_KEY=first/);

      upsertDotEnvKey({
        cwd: dir,
        key: 'MITII_API_KEY',
        value: 'second',
      });
      const text = readFileSync(path, 'utf8');
      expect(text).toMatch(/MITII_API_KEY=second/);
      expect(text.match(/MITII_API_KEY=/g)?.length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
