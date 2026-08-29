import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const MAX_OBSERVATIONS_PER_WORKSPACE = 10_000;

export interface MemoryObservation {
  id: string;
  createdAt: string;
  toolName?: string;
  hookType?: string;
  content: string;
  files: string[];
  hash: string;
  promotedMemoryId?: string;
}

interface ObservationEnvelope {
  storageVersion: 2;
  observations: MemoryObservation[];
}

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
    const current = await this.read();
    const next = [...current, observation];
    const evicted = evictOldestObservations(next, max);
    await this.write(evicted.kept);
    return evicted;
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
    try {
      const parsed = JSON.parse(raw) as Partial<ObservationEnvelope>;
      if (parsed.storageVersion !== 2 || !Array.isArray(parsed.observations)) {
        return [];
      }
      return parsed.observations.filter(isObservation);
    } catch {
      return [];
    }
  }

  private async write(observations: readonly MemoryObservation[]): Promise<void> {
    const envelope: ObservationEnvelope = {
      storageVersion: 2,
      observations: [...observations],
    };
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
    await rename(tempPath, this.filePath);
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

function isObservation(value: unknown): value is MemoryObservation {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const item = value as Partial<MemoryObservation>;
  return (
    typeof item.id === 'string' &&
    typeof item.createdAt === 'string' &&
    typeof item.content === 'string' &&
    typeof item.hash === 'string' &&
    Array.isArray(item.files)
  );
}
