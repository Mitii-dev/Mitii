import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout } from 'node:timers/promises';

/** Exclusive across instances/processes. A crashed owner's lock is deliberately
 * retained for explicit recovery rather than risking a stale-owner takeover. */
export async function withMemoryFileLock<T>(path: string, run: () => Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  const lock = `${path}.lock`;
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new Error('memory_storage_locked: writer active or lock requires recovery.');
      await setTimeout(20);
    }
  }
  try {
    await atomicMemoryWrite(`${lock}/owner.json`, JSON.stringify({ pid: process.pid, host: hostname(), id: randomUUID() }));
    return await run();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

/** Flush a unique temporary file before the atomic same-directory rename. */
export async function atomicMemoryWrite(path: string, body: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(body, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}
