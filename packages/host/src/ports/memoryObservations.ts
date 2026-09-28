import { readFile } from 'node:fs/promises';
import { MemoryContentPolicy } from '@mitii/v8';
import { z } from 'zod';
import { atomicMemoryWrite, withMemoryFileLock } from './memoryFileIO.js';
import { join } from 'node:path';

export const MAX_OBSERVATIONS_PER_WORKSPACE = 10_000;

const memoryObservationSchema = z.object({
  id: z.string().min(1), createdAt: z.string().datetime(), toolName: z.string().optional(),
  hookType: z.string().optional(), content: z.string().max(16_000), files: z.array(z.string()),
  hash: z.string().min(1), promotedMemoryId: z.string().optional(),
}).strict();
export type MemoryObservation = z.infer<typeof memoryObservationSchema>;
const observationEnvelopeSchema = z.object({ storageVersion: z.literal(2),
  observations: z.array(memoryObservationSchema) }).strict();

export interface EvictObservationsResult {
  kept: MemoryObservation[];
  evictedIds: string[];
}

/**
 * Raw, evictable traces under `<workspace>/.mitii/memory/observations.json`.
 * Durable facts stay in facts.json.
 */
export class FileWorkspaceObservationStore {
  private readonly filePath: string;

  constructor(workspaceRoot: string) {
    this.filePath = join(
      workspaceRoot,
      '.mitii',
      'memory',
      'observations.json',
    );
  }

  public async list(): Promise<MemoryObservation[]> {
    return this.read();
  }

  public async append(
    observation: MemoryObservation,
    max = MAX_OBSERVATIONS_PER_WORKSPACE,
  ): Promise<EvictObservationsResult> {
    return withMemoryFileLock(this.filePath, async () => {
    observation = memoryObservationSchema.parse(observation);
    const current = await this.read();
    const next = [...current, observation];
    const evicted = evictOldestObservations(next, max);
    await this.write(evicted.kept);
    return evicted;
    });
  }

  public async findRecentHash(
    hash: string,
    windowMs: number,
    now: Date,
  ): Promise<MemoryObservation | undefined> {
    const observations = await this.read();
    return observations.find((item) => {
      if (item.hash !== hash) {
        return false;
      }
      const age = now.getTime() - Date.parse(item.createdAt);
      return Number.isFinite(age) && age >= 0 && age < windowMs;
    });
  }

  private async read(): Promise<MemoryObservation[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
    return observationEnvelopeSchema.parse(JSON.parse(raw)).observations;
  }

  private async write(observations: readonly MemoryObservation[]): Promise<void> {
    const policy = new MemoryContentPolicy();
    const envelope = observationEnvelopeSchema.parse({ storageVersion: 2,
      observations: observations.map(row => ({ ...row, content: policy.sanitize(row.content),
        files: row.files.map(value => policy.sanitize(value)),
        ...(row.toolName ? { toolName: policy.sanitize(row.toolName) } : {}),
        ...(row.hookType ? { hookType: policy.sanitize(row.hookType) } : {}),
      })),
    });
    await atomicMemoryWrite(this.filePath, `${JSON.stringify(envelope, null, 2)}\n`);
  }
}

export function evictOldestObservations(
  observations: readonly MemoryObservation[],
  max = MAX_OBSERVATIONS_PER_WORKSPACE,
): EvictObservationsResult {
  if (observations.length <= max) {
    return { kept: [...observations], evictedIds: [] };
  }
  const sorted = [...observations].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
  const overflow = sorted.length - max;
  return {
    evictedIds: sorted.slice(0, overflow).map((item) => item.id),
    kept: sorted.slice(overflow),
  };
}

