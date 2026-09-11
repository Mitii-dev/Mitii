import type { SessionIo } from '../session.js';
import { createCliClient } from '../ports.js';

/**
 * `mitii restore --list <runId>`
 * `mitii restore <runId> <restorePointId>`
 */
export async function runRestoreCommand(params: {
  args: string[];
  cwd: string;
  json?: boolean;
  forceEcho?: boolean;
  io: SessionIo;
}): Promise<number> {
  const { args, cwd, json, forceEcho, io } = params;
  const listMode = args.includes('--list');
  const positional = args.filter((a) => a !== '--list' && !a.startsWith('-'));

  const { client } = createCliClient({
    cwd,
    forceEcho: forceEcho === true,
  });

  if (listMode) {
    const runId = positional[0];
    if (!runId) {
      io.writeStderr('mitii restore --list requires <runId>\n');
      return 2;
    }
    const points = await client.listRestorePoints(runId);
    if (json) {
      io.writeStdout(
        `${JSON.stringify({ runId, restorePoints: points }, null, 2)}\n`,
      );
    } else if (points.length === 0) {
      io.writeStdout(`No restore points for run ${runId}\n`);
    } else {
      for (const point of points) {
        io.writeStdout(
          `${point.restorePointId}\t${point.createdAt}\tfiles=${point.changedFileCount}\tmutation=${point.mutationCheckpointId}\n`,
        );
      }
    }
    return 0;
  }

  const runId = positional[0];
  const restorePointId = positional[1];
  if (!runId || !restorePointId) {
    io.writeStderr(
      'Usage: mitii restore <runId> <restorePointId>\n       mitii restore --list <runId>\n',
    );
    return 2;
  }

  const result = await client.restore({
    schemaVersion: 1,
    runId,
    restorePointId,
    workspaceRoot: cwd,
  });

  if (json) {
    io.writeStdout(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    io.writeStdout(
      `Restored ${result.restoredFiles.length} path(s) to ${restorePointId} (mode=${result.interactionMode})\n`,
    );
  }
  return 0;
}
