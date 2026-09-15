import { join } from 'node:path';

import { FileReviewRecordStore } from '@mitii/sdk';

/**
 * Durable review records under `<workspace>/.mitii/review/`.
 * These are structured review artifacts, not model-loop messages.
 */
export function createWorkspaceReviewStore(
  workspaceRoot: string,
): FileReviewRecordStore {
  return new FileReviewRecordStore(join(workspaceRoot, '.mitii', 'review'));
}
