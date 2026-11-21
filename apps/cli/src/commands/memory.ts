import type { SessionIo } from '../session.js';
import {
  approvePendingMemory,
  listPendingMemories,
  rejectPendingMemory,
  createWorkspaceMemoryStore,
} from '@mitii/host';
import { MemoryPipeline } from '@mitii/sdk';

import { loadMitiiHostConfig, resolveCliWorkspaceId } from '../config.js';

/** Same id agent runs use (`resolveCliPorts`), so approvals land in the run's memory scope. */
export function resolveMemoryWorkspaceId(cwd: string): string {
  return resolveCliWorkspaceId(loadMitiiHostConfig(cwd));
}

/**
 * `mitii memory pending|approve <id>|reject <id>`
 */
export async function runMemoryCommand(params: {
  args: string[];
  cwd: string;
  json?: boolean;
  io: SessionIo;
}): Promise<number> {
  const { args, cwd, json, io } = params;
  const [sub = '', id = ''] = args;
  const workspaceId = resolveMemoryWorkspaceId(cwd);

  if (sub === 'pending') {
    const pending = await listPendingMemories(cwd);
    if (json) {
      io.writeStdout(`${JSON.stringify(pending, null, 2)}\n`);
    } else if (pending.length === 0) {
      io.writeStdout('No pending memories.\n');
    } else {
      for (const item of pending) {
        io.writeStdout(
          `${item.id}\t${item.title ?? item.type}\t${item.content.slice(0, 80)}\n`,
        );
      }
    }
    return 0;
  }

  if (sub === 'approve') {
    if (!id) {
      io.writeStderr('Usage: mitii memory approve <pendingId>\n');
      return 2;
    }
    const store = createWorkspaceMemoryStore(cwd, workspaceId);
    const pipeline = new MemoryPipeline({ store });
    const result = await approvePendingMemory({
      workspaceRoot: cwd,
      workspaceId,
      pendingId: id,
      pipeline,
    });
    if (result.status !== 'committed') {
      io.writeStderr(`mitii memory approve: ${result.status}\n`);
      return 2;
    }
    io.writeStdout(`${result.memoryId ?? id}\n`);
    return 0;
  }

  if (sub === 'reject') {
    if (!id) {
      io.writeStderr('Usage: mitii memory reject <pendingId>\n');
      return 2;
    }
    const result = await rejectPendingMemory({
      workspaceRoot: cwd,
      pendingId: id,
      workspaceId,
    });
    if (!result.rejected) {
      io.writeStderr('mitii memory reject: not_found\n');
      return 2;
    }
    return 0;
  }

  io.writeStderr(
    'Usage: mitii memory pending | approve <id> | reject <id>\n',
  );
  return 2;
}
