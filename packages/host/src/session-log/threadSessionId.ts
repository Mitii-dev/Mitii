import { randomBytes } from 'node:crypto';

/**
 * Desktop/VS Code–style session id for `.mitii/logs/*-thread_….jsonl`.
 * Example: `thread_a1b2c3d4_e5f6a7`
 */
export function createMitiiThreadSessionId(): string {
  return `thread_${randomBytes(4).toString('hex')}_${randomBytes(3).toString('hex')}`;
}
