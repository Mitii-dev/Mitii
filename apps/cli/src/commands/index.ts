import {
  formatIndexPipelineHealthLines,
  readIndexPipelineHealth,
} from '@mitii/host';

import { loadMitiiHostConfig } from '../config.js';
import { runFullWorkspaceIndex } from '../fullWorkspaceIndex.js';
import { createCliClient } from '../ports.js';
import { resolveCliSemanticIndexSettings } from '../semanticIndex.js';
import { serializeCliJson, type SessionIo } from '../session.js';
import { persistLatestRepositoryState } from '../stateCache.js';
import { buildWorkspaceSnapshot } from '../workspaceSnapshot.js';
import {
  summarizeRepositoryCapabilities,
  writeIndexHealthLines,
  writeRepositoryCapabilityLines,
  type IndexingDiagnostics,
  type IndexingFileResultSnapshot,
} from './repositoryReport.js';

export async function runIndexStatus(options: {
  cwd: string;
  json: boolean;
  io: SessionIo;
}): Promise<number> {
  const health = readIndexPipelineHealth({ workspaceRoot: options.cwd });
  if (options.json) {
    options.io.writeStdout(`${serializeCliJson({ health })}\n`);
  } else {
    for (const line of formatIndexPipelineHealthLines(health)) {
      options.io.writeStdout(`${line}\n`);
    }
  }
  if (health.overall === 'missing') return 1;
  if (health.overall === 'failed') return 1;
  return 0;
}

export async function runIndex(options: {
  cwd: string;
  json: boolean;
  forceEcho: boolean;
  io: SessionIo;
}): Promise<number> {
  const { client, ports } = await createCliClient({
    cwd: options.cwd,
    forceEcho: options.forceEcho,
  });
  let fileCount = 0;
  let truncated = false;
  let indexMode: 'full' | 'host_snapshot' = 'full';
  let databasePath: string | undefined;
  let vectorIndex: Awaited<
    ReturnType<typeof runFullWorkspaceIndex>
  >['vectorIndex'] | undefined;
  let indexingDiagnostics: IndexingDiagnostics | undefined;
  let published;
  try {
    const config = loadMitiiHostConfig(options.cwd);
    const full = await runFullWorkspaceIndex({
      cwd: options.cwd,
      workspaceId: ports.workspaceId,
      force: true,
      semanticIndex: resolveCliSemanticIndexSettings({
        env: process.env,
        config,
      }),
    });
    fileCount = full.fileCount;
    truncated = full.truncated;
    databasePath = full.databasePath;
    vectorIndex = full.vectorIndex;
    const fileResults =
      full.indexing.fileResults as IndexingFileResultSnapshot[];
    indexingDiagnostics = {
      status: full.indexing.status,
      cleanupAllowed: full.indexing.cleanupAllowed,
      statistics: full.indexing.statistics,
      warnings: full.indexing.warnings,
      rootResults: full.indexing.rootResults,
      incompleteFiles: fileResults
        .filter((result) => result.status !== 'complete')
        .map((result) => ({
          path: result.relativePath,
          status: result.status,
          analysisStatus: result.analysisStatus,
          chunkingStatus: result.chunkingStatus,
          codeIndexStatus: result.codeIndexStatus,
          textIndexStatus: result.textIndexStatus,
          warnings: result.warnings,
        })),
    };
    published = await client.publishRepositoryStateFromIndexing(full.indexing, {
      catalogRevisionByRoot: full.catalogRevisionByRoot,
      graphRevisionByRoot: full.graphRevisionByRoot,
      mapRevisionByRoot: full.mapRevisionByRoot,
    });
  } catch (error) {
    indexMode = 'host_snapshot';
    const errorDetail =
      process.env.MITII_DEBUG_INDEX === '1' && error instanceof Error
        ? (error.stack ?? error.message)
        : error instanceof Error
          ? error.message
          : String(error);
    options.io.writeStderr(
      `[mitii] full index unavailable; falling back to host snapshot: ${errorDetail}\n`,
    );
    const snapshot = await buildWorkspaceSnapshot({
      workspaceRoot: options.cwd,
      workspaceId: ports.workspaceId,
    });
    fileCount = snapshot.fileCount;
    truncated = snapshot.truncated;
    published = await client.publishRepositoryState(snapshot.candidate);
  }
  if (published.status === 'published') {
    persistLatestRepositoryState(options.cwd, published.descriptor);
  }
  if (options.json) {
    const health = readIndexPipelineHealth({ workspaceRoot: options.cwd });
    options.io.writeStdout(
      `${serializeCliJson({
        published,
        fileCount,
        truncated,
        indexMode,
        health,
        ...(indexingDiagnostics ? { indexing: indexingDiagnostics } : {}),
        ...(published.status === 'published'
          ? {
              capabilitySummary: summarizeRepositoryCapabilities(
                published.descriptor,
              ),
            }
          : {}),
        ...(databasePath ? { databasePath } : {}),
        ...(vectorIndex ? { vectorIndex } : {}),
      })}\n`,
    );
  } else if (published.status === 'published') {
    options.io.writeStdout(
      `indexed workspaceId=${published.reference.workspaceId} stateToken=${published.reference.stateToken.slice(0, 16)}… readiness=${published.descriptor.readiness} files=${fileCount}${truncated ? ' (truncated)' : ''} mode=${indexMode}\n`,
    );
    if (vectorIndex) {
      options.io.writeStdout(
        `vectorIndex=${vectorIndex.status}${vectorIndex.profileId ? ` profile=${vectorIndex.profileId}` : ''}${vectorIndex.reason ? ` reason=${vectorIndex.reason}` : ''}\n`,
      );
    }
    writeRepositoryCapabilityLines(options.io, published.descriptor);
    writeIndexHealthLines(options.io, options.cwd);
    for (const reason of published.descriptor.reasons) {
      options.io.writeStderr(`[mitii] ${reason.code}: ${reason.message}\n`);
    }
  } else {
    options.io.writeStderr(
      `[mitii] index failed: ${published.status} ${'message' in published ? published.message : ''}\n`,
    );
    return 1;
  }
  return published.status === 'published' ? 0 : 1;
}
