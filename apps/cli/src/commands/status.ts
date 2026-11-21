import {
  readIndexPipelineHealth,
} from '@mitii/host';

import { createCliClient } from '../ports.js';
import { serializeCliJson, type SessionIo } from '../session.js';
import { loadPersistedRepositoryState } from '../stateCache.js';
import {
  summarizeRepositoryCapabilities,
  writeIndexHealthLines,
  writeRepositoryCapabilityLines,
} from './repositoryReport.js';

export async function runStatus(options: {
  cwd: string;
  json: boolean;
  forceEcho: boolean;
  io: SessionIo;
}): Promise<number> {
  const { client, ports } = await createCliClient({
    cwd: options.cwd,
    forceEcho: options.forceEcho,
  });
  const latest =
    (await client.getLatestRepositoryState(ports.workspaceId)) ??
    loadPersistedRepositoryState(options.cwd);
  const health = readIndexPipelineHealth({ workspaceRoot: options.cwd });
  if (options.json) {
    options.io.writeStdout(
      `${serializeCliJson({
        latest,
        health,
        ...(latest
          ? { capabilitySummary: summarizeRepositoryCapabilities(latest) }
          : {}),
      })}\n`,
    );
    return latest || health.overall !== 'missing' ? 0 : 1;
  }
  if (!latest) {
    options.io.writeStderr(
      '[mitii] no published repository state — run `mitii index` first\n',
    );
    writeIndexHealthLines(options.io, options.cwd);
    return health.overall === 'missing' ? 1 : 0;
  }
  options.io.writeStdout(
    `status workspaceId=${latest.workspaceId} readiness=${latest.readiness} scan=${latest.scanCompleteness} stateToken=${latest.stateToken.slice(0, 16)}…\n`,
  );
  writeRepositoryCapabilityLines(options.io, latest);
  writeIndexHealthLines(options.io, options.cwd);
  for (const reason of latest.reasons) {
    options.io.writeStderr(`[mitii] ${reason.code}: ${reason.message}\n`);
  }
  return 0;
}
