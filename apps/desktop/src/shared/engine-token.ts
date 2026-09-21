/**
 * Cryptographically strong token for local bearer auth.
 * Kept separate from the HTTP server so Electron main does not load agent deps.
 */

import { randomBytes } from 'node:crypto';

export function generateEngineToken(): string {
  return randomBytes(24).toString('base64url');
}
