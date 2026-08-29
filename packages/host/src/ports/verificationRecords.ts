import { join } from 'node:path';

import { FileVerificationRecordStore } from '@mitii/sdk';

/**
 * Durable verification records under `<workspace>/.mitii/verification/`.
 * These are retry handles, not model-loop messages.
 */
export function createWorkspaceVerificationStore(
  workspaceRoot: string,
): FileVerificationRecordStore {
  return new FileVerificationRecordStore(
    join(workspaceRoot, '.mitii', 'verification'),
  );
}
