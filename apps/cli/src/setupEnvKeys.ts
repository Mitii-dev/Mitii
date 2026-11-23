import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { ProviderPreset } from '@mitii/host';

/**
 * Preferred env var for a preset. Keys never go in config.json.
 */
export function preferredApiKeyEnvName(preset: ProviderPreset): string {
  if (preset.type === 'anthropic') return 'ANTHROPIC_API_KEY';
  if (preset.type === 'gemini') return 'GEMINI_API_KEY';
  if (preset.id === 'openai') return 'OPENAI_API_KEY';
  return 'MITII_API_KEY';
}

export function resolveSetupDotEnvPath(options: {
  cwd: string;
  global?: boolean;
}): string {
  return options.global
    ? join(homedir(), '.mitii', '.env')
    : join(options.cwd, '.mitii', '.env');
}

function escapeDotEnvValue(value: string): string {
  if (/[\s#"']/.test(value) || value.includes('\\')) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}

/**
 * Upsert KEY=VALUE in a dotenv file. Creates parent dirs as needed.
 * Returns the absolute path written.
 */
export function upsertDotEnvKey(options: {
  cwd: string;
  global?: boolean;
  key: string;
  value: string;
  path?: string;
}): string {
  const path = options.path ?? resolveSetupDotEnvPath(options);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.key)) {
    throw new Error(`Invalid env key: ${options.key}`);
  }
  mkdirSync(dirname(path), { recursive: true });
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const line = `${options.key}=${escapeDotEnvValue(options.value)}`;
  const keyLine = new RegExp(`^${options.key}=.*$`, 'm');
  let next: string;
  if (keyLine.test(existing)) {
    next = existing.replace(keyLine, line);
  } else {
    const trimmed = existing.replace(/\s+$/, '');
    next = trimmed ? `${trimmed}\n${line}\n` : `${line}\n`;
  }
  writeFileSync(path, next, 'utf8');
  return path;
}
