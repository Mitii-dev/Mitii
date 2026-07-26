import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RepositoryStateDescriptor } from '@mitii/sdk';

const STATE_DIR = '.mitii';
const STATE_FILE = 'last-repository-state.json';

export function persistLatestRepositoryState(
  cwd: string,
  descriptor: RepositoryStateDescriptor,
): string {
  const dir = join(cwd, STATE_DIR);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, STATE_FILE);
  writeFileSync(path, `${JSON.stringify(descriptor, null, 2)}\n`);
  return path;
}

export function loadPersistedRepositoryState(
  cwd: string,
): RepositoryStateDescriptor | undefined {
  const path = join(cwd, STATE_DIR, STATE_FILE);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as RepositoryStateDescriptor;
  } catch {
    return undefined;
  }
}
