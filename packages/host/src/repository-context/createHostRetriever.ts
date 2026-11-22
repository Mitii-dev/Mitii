import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  HybridRetrievalFactory,
  IdentifierAwareRetrievalReranker,
  CrossEncoderRetrievalReranker,
  createWorkspaceRetrievalRuntime,
  type RepositoryStateDescriptor,
  type RepositoryContextRetrieverPort,
  type HybridRetrievalInput,
  type HybridRetrievalResult,
  type RepositoryCapabilityStatus,
  type RepositoryRootState,
  type EmbeddingProvider,
  type CrossEncoderDocumentScorer,
} from '@mitii/v8';
import { CorpusRetrievalSource } from '../corpus/CorpusRetrievalSource.js';
import { corpusIndexExists } from '../corpus/corpusIndex.js';
import {
  alignSemanticSettingsWithPersistedProfile,
  createLanceDbConnection,
  readIndexRuntimeMetadata,
  resolveHostEmbeddingProvider,
  type SemanticIndexSettings,
} from '../indexing/semanticIndex.js';
import type { OpenHostSqliteDatabase } from '../sqlite/types.js';

export function createHostRetriever(options: {
  workspaceRoot: string;
  textIndexDatabasePath: string;
  openDatabase: OpenHostSqliteDatabase;
  resolvedDescriptors: ReadonlyMap<string, RepositoryStateDescriptor>;
  semanticIndex?: SemanticIndexSettings;
  corpusEnabled?: boolean;
  crossEncoderScorer?: CrossEncoderDocumentScorer;
}): RepositoryContextRetrieverPort {
  return {
    retrieve: async (
      input: HybridRetrievalInput,
    ): Promise<HybridRetrievalResult> => {
      const descriptor = resolveHostRetrievalDescriptor(
        input.workspaceSnapshotId,
        options.resolvedDescriptors,
      );
      const extraWarnings: HybridRetrievalResult['warnings'] = [];
      const sqliteExists = existsSync(options.textIndexDatabasePath);

      let database: ReturnType<OpenHostSqliteDatabase> | undefined;
      let retrievalClose: (() => Promise<void>) | undefined;
      let textIndex: ReturnType<typeof createWorkspaceRetrievalRuntime>['textIndex'] | undefined;
      let vectorIndex: ReturnType<typeof createWorkspaceRetrievalRuntime>['vectorIndex'];
      let embeddingProvider: ReturnType<typeof createWorkspaceRetrievalRuntime>['embeddingProvider'];

      try {
        if (sqliteExists) {
          try {
            const vectorRuntime = descriptor
              ? await resolveVectorRetrievalRuntime({
                  workspaceRoot: options.workspaceRoot,
                  descriptor,
                  semanticIndex: options.semanticIndex,
                })
              : {
                  status: 'unavailable' as const,
                  reason:
                    'Vector retrieval is unavailable (descriptor_missing): pinned repository state was not available. Lexical and repository-intelligence sources continued.',
                };
            if (vectorRuntime.status !== 'ready') {
              extraWarnings.push({
                code: 'optional_source_unavailable',
                message:
                  vectorRuntime.reason ??
                  'Vector retrieval is unavailable; remaining sources continued.',
              });
            }
            database = options.openDatabase(options.textIndexDatabasePath, {
              readonly: true,
              fileMustExist: true,
            });
            const runtime =
              vectorRuntime.status === 'unavailable' || !('vector' in vectorRuntime)
                ? createWorkspaceRetrievalRuntime({
                    textIndexDatabase: database as never,
                  })
                : createWorkspaceRetrievalRuntime({
                    textIndexDatabase: database as never,
                    vector: vectorRuntime.vector,
                  });
            retrievalClose = () => runtime.close();
            textIndex = runtime.textIndex;
            vectorIndex = runtime.vectorIndex;
            embeddingProvider = runtime.embeddingProvider;
          } catch (error) {
            extraWarnings.push({
              code: 'optional_source_unavailable',
              message: `SQLite text retrieval failed; remaining sources continued: ${
                error instanceof Error ? error.message : String(error)
              }`,
            });
          }
        } else {
          extraWarnings.push({
            code: 'optional_source_unavailable',
            message: descriptor && hasUsableTextIndex(descriptor)
              ? 'SQLite text index database is not present; remaining sources continued.'
              : 'Pinned repository state does not expose a ready text index; remaining sources continued.',
          });
        }

        const additionalSources =
          options.corpusEnabled && corpusIndexExists(options.workspaceRoot)
            ? ([
                {
                  source: new CorpusRetrievalSource({
                    workspaceRoot: options.workspaceRoot,
                  }),
                },
              ] as NonNullable<
                Parameters<HybridRetrievalFactory['create']>[0]['additionalSources']
              >)
            : undefined;

        const retriever = new HybridRetrievalFactory().create({
          ...(textIndex ? { textIndex } : {}),
          reranker: options.crossEncoderScorer
            ? new CrossEncoderRetrievalReranker(options.crossEncoderScorer)
            : new IdentifierAwareRetrievalReranker(),
          ...(vectorIndex && embeddingProvider
            ? {
                vectorIndex,
                embeddingProvider,
              }
            : {}),
          ...(additionalSources ? { additionalSources } : {}),
        });

        const runRetrieve = async (
          retrieveInput: HybridRetrievalInput,
        ): Promise<HybridRetrievalResult> => {
          const result = await retriever.retrieve(retrieveInput);
          return {
            ...result,
            warnings: [...result.warnings, ...extraWarnings],
          };
        };

        try {
          return await runRetrieve(input);
        } catch (error) {
          extraWarnings.push({
            code: 'optional_source_unavailable',
            message: `Repository intelligence was dropped after retrieval failed; remaining sources continued: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
          try {
            return await runRetrieve(stripRepoIntelligence(input));
          } catch (retryError) {
            return emptyHostRetrieval(
              input.query,
              `Hybrid retrieval failed; using workspace file map fallback: ${
                retryError instanceof Error ? retryError.message : String(retryError)
              }`,
            );
          }
        }
      } finally {
        await retrievalClose?.().catch(() => undefined);
        database?.close();
      }
    },
  };
}

function resolveHostRetrievalDescriptor(
  snapshotId: string | undefined,
  descriptors: ReadonlyMap<string, RepositoryStateDescriptor>,
): RepositoryStateDescriptor | undefined {
  if (snapshotId) {
    const pinned = descriptors.get(snapshotId);
    if (pinned) {
      return pinned;
    }
  }
  const usable = [...descriptors.values()].filter(hasUsableTextIndex);
  if (usable.length === 1) {
    return usable[0];
  }
  if (descriptors.size === 1) {
    return [...descriptors.values()][0];
  }
  return undefined;
}

function stripRepoIntelligence(
  input: HybridRetrievalInput,
): HybridRetrievalInput {
  const { repoMap: _repoMap, repoGraph: _repoGraph, codeIndexChangeToken: _token, ...rest } =
    input;
  return rest;
}

async function resolveVectorRetrievalRuntime(options: {
  workspaceRoot: string;
  descriptor: RepositoryStateDescriptor;
  semanticIndex?: SemanticIndexSettings;
}): Promise<
  | {
      status: 'ready' | 'degraded';
      reason?: string;
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
  if (!options.semanticIndex?.enabled) {
    return {
      status: 'unavailable',
      reason:
        'Vector retrieval is unavailable (semantic_index_disabled): semantic index is disabled or not configured. Reindex after enabling embeddings.',
    };
  }
  const metadata = readIndexRuntimeMetadata(
    join(options.workspaceRoot, '.mitii', 'index-runtime.json'),
  );
  if (!metadata) {
    return {
      status: 'unavailable',
      reason:
        'Vector retrieval is unavailable (runtime_missing): index-runtime.json is missing or invalid. Reindex the workspace.',
    };
  }
  if (!metadata.embeddingProfile?.id) {
    return {
      status: 'unavailable',
      reason:
        'Vector retrieval is unavailable (embedding_profile_missing): index-runtime.json does not describe a ready embedding profile. Reindex the workspace.',
    };
  }
  let vectorCapability = vectorCapabilityForProfile(
    options.descriptor,
    metadata.embeddingProfile.id,
  );
  if (!vectorCapability) {
    // Fingerprint republish (and workspace-id remaps) often omit vectorProfile
    // even when LanceDB + index-runtime still hold a ready embedding index.
    // Prefer using the on-disk vectors over dropping semantic search.
    if (existsSync(metadata.lanceDbPath)) {
      vectorCapability = 'ready';
    } else {
      return {
        status: 'unavailable',
        reason:
          'Vector retrieval is unavailable (published_profile_missing): published repository state does not expose the persisted vector profile. Reindex the workspace.',
      };
    }
  }
  const alignedSettings = alignSemanticSettingsWithPersistedProfile(
    options.semanticIndex,
    metadata.embeddingProfile,
  );
  if (!alignedSettings) {
    return {
      status: 'unavailable',
      reason:
        'Vector retrieval is unavailable (profile_mismatch): current embedding profile differs from the profile that wrote LanceDB. Reindex to rebuild embeddings.',
    };
  }
  const provider = await resolveHostEmbeddingProvider(alignedSettings);
  try {
    const vector = {
      embeddingProvider: provider,
      lanceConnection: await createLanceDbConnection(metadata.lanceDbPath),
    };
    if (vectorCapability === 'degraded') {
      return {
        status: 'degraded',
        reason:
          'Vector retrieval is degraded (partial_index): the published embedding index is incomplete. Reindex to restore full semantic search.',
        vector,
      };
    }
    return {
      status: 'ready',
      vector,
    };
  } catch (error) {
    return {
      status: 'unavailable',
      reason: `Vector retrieval is unavailable (connection_failed): ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function vectorCapabilityForProfile(
  descriptor: RepositoryStateDescriptor,
  profileId: string,
): 'ready' | 'degraded' | undefined {
  for (const root of descriptor.roots) {
    if (root.vectorProfile !== profileId) continue;
    const capability = root.capabilities.find(
      (entry: RepositoryCapabilityStatus) => entry.capability === 'vectorIndex',
    );
    if (capability?.status === 'available') {
      return 'ready';
    }
    if (capability?.status === 'degraded') {
      return 'degraded';
    }
  }
  return undefined;
}

function hasUsableTextIndex(descriptor: RepositoryStateDescriptor): boolean {
  return descriptor.roots.some(
    (root: RepositoryRootState) =>
      root.textIndexRevision &&
      root.capabilities.some(
        (capability: RepositoryCapabilityStatus) =>
          capability.capability === 'textIndex' &&
          capability.status !== 'unavailable',
      ),
  );
}

function emptyHostRetrieval(
  query: string,
  message: string,
): HybridRetrievalResult {
  return {
    schemaVersion: 1 as const,
    query,
    status: 'empty' as const,
    candidates: [],
    sourceReports: [],
    warnings: [
      {
        code: 'optional_source_unavailable' as const,
        message,
      },
    ],
    truncated: false,
    statistics: {
      configuredSources: 0,
      attemptedSources: 0,
      successfulSources: 0,
      failedSources: 0,
      skippedSources: 0,
      sourceCandidates: 0,
      uniqueCandidates: 0,
      duplicateCandidatesRemoved: 0,
      returnedCandidates: 0,
    },
  };
}
