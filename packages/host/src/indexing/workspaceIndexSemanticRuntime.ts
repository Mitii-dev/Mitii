import type {
  EmbeddingProfile,
  EmbeddingProvider,
  WorkspaceIndexingPipelineResult,
} from '@mitii/v8';

import {
  createLanceDbConnection,
  probeEmbeddingProvider,
  resolveHostEmbeddingProvider,
  type SemanticIndexSettings,
} from './semanticIndex.js';
import type { FullWorkspaceIndexResult } from './workspaceIndexTypes.js';

export async function disposeSemanticRuntime(
  semanticRuntime:
    | Awaited<ReturnType<typeof resolveSemanticRuntime>>
    | undefined,
): Promise<void> {
  if (!semanticRuntime || semanticRuntime.status !== 'ready') {
    return;
  }
  try {
    // Close Lance eagerly; the embedding provider may still be reused by the
    // same process (CLI ask indexes then retrieves). WASM ORT does not abort
    // on process teardown, so skipping provider.dispose here is intentional.
    semanticRuntime.vector.lanceConnection.close?.();
  } catch {
    // Best-effort: Lance close must not mask the indexing result.
  }
}

export function mergeLexicalAndEmbeddingResults(
  lexical: WorkspaceIndexingPipelineResult,
  embedding: WorkspaceIndexingPipelineResult,
): WorkspaceIndexingPipelineResult {
  const embeddingByRoot = new Map(
    embedding.rootResults.map((root) => [root.rootId, root]),
  );

  const rootResults = lexical.rootResults.map((root) => {
    const emb = embeddingByRoot.get(root.rootId);
    if (!emb) return root;

    const embeddingWarnings = emb.warnings.filter(
      (warning) => warning.stage === 'embedding',
    );
    const structuralPartial =
      root.status === 'partial' ||
      emb.status === 'partial' ||
      emb.embeddingStatus === 'partial';

    return {
      ...root,
      status:
        emb.status === 'cancelled' || root.status === 'cancelled'
          ? ('cancelled' as const)
          : structuralPartial
            ? ('partial' as const)
            : root.status === 'skipped' && emb.status === 'complete'
              ? ('complete' as const)
              : root.status,
      ...(emb.embeddingStatus
        ? { embeddingStatus: emb.embeddingStatus }
        : {}),
      ...(emb.embeddingProfileId
        ? { embeddingProfileId: emb.embeddingProfileId }
        : {}),
      ...(emb.initialTextRevision !== undefined
        ? { initialTextRevision: emb.initialTextRevision }
        : {}),
      ...(emb.finalTextRevision !== undefined
        ? { finalTextRevision: emb.finalTextRevision }
        : {}),
      ...(emb.latestTextRevision !== undefined
        ? { latestTextRevision: emb.latestTextRevision }
        : {}),
      embeddedChunks: emb.embeddedChunks,
      vectorsDeleted: emb.vectorsDeleted,
      warnings: [...root.warnings, ...embeddingWarnings],
    };
  });

  return {
    ...lexical,
    rootResults,
    warnings: [
      ...lexical.warnings,
      ...embedding.warnings.filter((warning) => warning.stage === 'embedding'),
    ],
    statistics: {
      ...lexical.statistics,
      embeddedChunks: embedding.statistics.embeddedChunks,
    },
  };
}

export type SemanticRuntimeCandidate =
  | {
      status: 'ready';
      settings: SemanticIndexSettings;
      profile: EmbeddingProfile;
    }
  | {
      status: 'unavailable';
      reason: string;
    };

export async function resolveSemanticCandidate(
  settings: SemanticIndexSettings | undefined,
): Promise<SemanticRuntimeCandidate> {
  if (!settings?.enabled) {
    return {
      status: 'unavailable',
      reason: 'Semantic index is disabled or not configured.',
    };
  }

  const probe = await probeEmbeddingProvider(settings);
  if (!probe.ok) {
    return {
      status: 'unavailable',
      reason: probe.reason,
    };
  }

  const runtimeSettings =
    probe.dimensions === settings.dimensions
      ? settings
      : {
          ...settings,
          dimensions: probe.dimensions,
        };
  const provider = await resolveHostEmbeddingProvider(runtimeSettings);

  return {
    status: 'ready',
    settings: runtimeSettings,
    profile: provider.profile,
  };
}

export async function resolveSemanticRuntime(
  candidate: SemanticRuntimeCandidate,
  lanceDbPath: string,
): Promise<
  | {
      status: 'ready';
      provider: EmbeddingProvider;
      vector: {
        embeddingProvider: EmbeddingProvider;
        lanceConnection: Awaited<ReturnType<typeof createLanceDbConnection>>;
      };
    }
  | {
      status: 'unavailable';
      reason: string;
    }
> {
  if (candidate.status !== 'ready') {
    return {
      status: 'unavailable',
      reason: candidate.reason,
    };
  }
  try {
    const provider = await resolveHostEmbeddingProvider(candidate.settings);
    const lanceConnection = await createLanceDbConnection(lanceDbPath);
    return {
      status: 'ready',
      provider,
      vector: {
        embeddingProvider: provider,
        lanceConnection,
      },
    };
  } catch (error) {
    return {
      status: 'unavailable',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function resolveVectorIndexStatus(options: {
  semanticRuntime: Awaited<ReturnType<typeof resolveSemanticRuntime>>;
  indexing: WorkspaceIndexingPipelineResult;
  lanceDbPath: string;
  runtimeMetadataPath: string;
}): FullWorkspaceIndexResult['vectorIndex'] {
  if (options.semanticRuntime.status !== 'ready') {
    return {
      status: 'unavailable',
      reason: options.semanticRuntime.reason,
    };
  }

  const embeddingWarnings = options.indexing.rootResults.flatMap(
    (root: WorkspaceIndexingPipelineResult['rootResults'][number]) =>
      root.warnings
        .filter(
          (
            warning: WorkspaceIndexingPipelineResult['rootResults'][number]['warnings'][number],
          ) => warning.stage === 'embedding',
        )
        .map(
          (
            warning: WorkspaceIndexingPipelineResult['rootResults'][number]['warnings'][number],
          ) => warning.message,
        ),
  );
  const vectorReady =
    options.indexing.rootResults.length > 0 &&
    options.indexing.rootResults.every(
      (root: WorkspaceIndexingPipelineResult['rootResults'][number]) =>
        root.embeddingStatus === 'complete' ||
        root.embeddingStatus === 'unchanged',
    );

  if (vectorReady) {
    return {
      status: 'ready',
      profileId: options.semanticRuntime.provider.profile.id,
      lanceDbPath: options.lanceDbPath,
      runtimeMetadataPath: options.runtimeMetadataPath,
    };
  }

  const anyPartial = options.indexing.rootResults.some(
    (root: WorkspaceIndexingPipelineResult['rootResults'][number]) =>
      root.embeddingStatus === 'partial',
  );
  return {
    status: anyPartial ? 'degraded' : 'unavailable',
    profileId: options.semanticRuntime.provider.profile.id,
    reason:
      embeddingWarnings.join('; ') ||
      'Embedding synchronization did not complete for every root.',
    lanceDbPath: options.lanceDbPath,
    runtimeMetadataPath: options.runtimeMetadataPath,
  };
}
