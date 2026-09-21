/**
 * Secret storage for Desktop (provider + search API keys).
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { safeStorage } from 'electron';

type SecretKind = 'provider-api-key' | 'search-api-key';

function keyPath(userDataPath: string, kind: SecretKind): string {
  return join(userDataPath, 'secrets', `${kind}.bin`);
}

function readSecret(
  userDataPath: string,
  kind: SecretKind,
): string | undefined {
  const path = keyPath(userDataPath, kind);
  if (!existsSync(path)) return undefined;
  try {
    const buf = readFileSync(path);
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(buf);
    }
    return buf.toString('utf8');
  } catch {
    return undefined;
  }
}

function writeSecret(
  userDataPath: string,
  kind: SecretKind,
  value: string,
): void {
  const path = keyPath(userDataPath, kind);
  mkdirSync(dirname(path), { recursive: true });
  const trimmed = value.trim();
  if (!trimmed) {
    clearSecret(userDataPath, kind);
    return;
  }
  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(path, safeStorage.encryptString(trimmed));
    return;
  }
  writeFileSync(path, trimmed, 'utf8');
}

function clearSecret(userDataPath: string, kind: SecretKind): void {
  const path = keyPath(userDataPath, kind);
  if (existsSync(path)) unlinkSync(path);
}

export function hasStoredApiKey(userDataPath: string): boolean {
  return existsSync(keyPath(userDataPath, 'provider-api-key'));
}

export function readStoredApiKey(userDataPath: string): string | undefined {
  return readSecret(userDataPath, 'provider-api-key');
}

export function writeStoredApiKey(userDataPath: string, apiKey: string): void {
  writeSecret(userDataPath, 'provider-api-key', apiKey);
}

export function clearStoredApiKey(userDataPath: string): void {
  clearSecret(userDataPath, 'provider-api-key');
}

export function hasStoredSearchApiKey(userDataPath: string): boolean {
  return existsSync(keyPath(userDataPath, 'search-api-key'));
}

export function readStoredSearchApiKey(
  userDataPath: string,
): string | undefined {
  return readSecret(userDataPath, 'search-api-key');
}

export function writeStoredSearchApiKey(
  userDataPath: string,
  apiKey: string,
): void {
  writeSecret(userDataPath, 'search-api-key', apiKey);
}

export function clearStoredSearchApiKey(userDataPath: string): void {
  clearSecret(userDataPath, 'search-api-key');
}
