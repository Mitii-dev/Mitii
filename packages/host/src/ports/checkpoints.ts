import { join } from 'node:path';

import { FileRunCheckpointStore } from '@mitii/sdk';

/**
 * Durable agent-run checkpoints under `<workspace>/.mitii/checkpoints/`.
 */
export function createWorkspaceCheckpointStore(
  workspaceRoot: string,
): FileRunCheckpointStore {
  return new FileRunCheckpointStore(
    join(workspaceRoot, '.mitii', 'checkpoints'),
  );
}
