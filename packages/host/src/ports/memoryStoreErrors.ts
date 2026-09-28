import { z } from 'zod';

export const memoryStorageErrorCodeSchema = z.enum([
  'memory_storage_corrupt',
  'memory_storage_version_unsupported',
  'memory_storage_recovery_required',
  'memory_storage_invalid_fact',
]);

export type MemoryStorageErrorCode = z.infer<typeof memoryStorageErrorCodeSchema>;

const MESSAGES: Record<MemoryStorageErrorCode, string> = {
  memory_storage_corrupt:
    'Memory storage contains an invalid envelope. Preserve the original file and recover it before retrying.',
  memory_storage_version_unsupported:
    'Memory storage uses an unsupported version. Open it with a compatible version of Mitii before retrying.',
  memory_storage_recovery_required:
    'Memory storage contains invalid facts or duplicate IDs. Valid facts remain readable; recover the original file before modifying memory.',
  memory_storage_invalid_fact:
    'Memory mutation rejected: a fact failed schema validation. Existing storage was not changed.',
};

/** Storage failures expose stable codes without including stored payloads. */
export class MemoryStorageError extends Error {
  public readonly code: MemoryStorageErrorCode;

  constructor(code: MemoryStorageErrorCode) {
    const parsed = memoryStorageErrorCodeSchema.parse(code);
    super(MESSAGES[parsed]);
    this.name = 'MemoryStorageError';
    this.code = parsed;
  }
}
