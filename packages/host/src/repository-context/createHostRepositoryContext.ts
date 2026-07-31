import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  ContextAssemblyFactory,
  ContextSelector,
  HybridRetrievalFactory,
  NodeFileSystemAdapter,
  RepositoryContextPipeline,
  createWorkspaceRetrievalRuntime,
  repoGraphSchema,
  repoMapSchema,
  type RepoGraph,
  type RepoMap,
  type RepositoryStateDescriptor,
  type RepositoryStatePipeline,
  type RepositoryStateReference,
  type RepositoryContextAssemblerPort,
  type RepositoryContextRetrieverPort,
  type RepositoryContextSelectorPort,
  type ContextAssemblyInput,
  type ContextAssemblyResult,
  type HybridRetrievalInput,
  type HybridRetrievalResult,
  type RepositoryCapabilityStatus,
  type RepositoryRootState,
  type WorkspaceFileEntry,
  type WorkspaceSnapshot,
} from '@mitii/v8';
import {
  OpenAiCompatibleEmbeddingProvider,
  createLanceDbConnection,
  readIndexRuntimeMetadata,
  type SemanticIndexSettings,
} from '../indexing/semanticIndex.js';
import { WORKSPACE_WALK_SKIP_DIR_NAMES } from '../internal/workspaceWalk.js';
import type { OpenHostSqliteDatabase } from '../sqlite/types.js';

const MAX_REPO_MAP_FILES = 400;
const MAX_REPO_MAP_CHARS = 24_000;
const INDEX_DB_FILE = 'repository-index.sqlite';
const HEX_SNAPSHOT_ID = /^[a-f0-9]{64}$/;

/**
 * Host-side Repository Context shared by VS Code and CLI.
 * Resolves published state + injects a file-tree block so repository routes
 * can proceed and the model can see the workspace layout.
 */
export function createHostRepositoryContext(options: {
  repositoryState: RepositoryStatePipeline;
  workspaceRoot: string;
  openDatabase: OpenHostSqliteDatabase;
  textIndexDatabasePath?: string;
  semanticIndex?: SemanticIndexSettings;
}): RepositoryContextPipeline {
  const { repositoryState, workspaceRoot } = options;
  const textIndexDatabasePath =
    options.textIndexDatabasePath ?? join(workspaceRoot, '.mitii', INDEX_DB_FILE);
  const resolvedDescriptors = new Map<string, RepositoryStateDescriptor>();
  const selector: RepositoryContextSelectorPort = new ContextSelector();
  const defaultAssembler = new ContextAssemblyFactory().create({
    fileSystem: new NodeFileSystemAdapter(),
  });

  return new RepositoryContextPipeline({
    stateResolver: {
      resolve: async (reference: RepositoryStateReference) => {
        const read = await repositoryState.read({
          workspaceId: reference.workspaceId,
          stateToken: reference.stateToken,
        });
        if (read.status !== 'found') {
          return {
            status: 'not_found',
            code:
              read.code === 'workspace_mismatch'
                ? 'workspace_mismatch'
                : 'unknown_state_token',
            message: read.message,
          };
        }
        const descriptor = read.descriptor;
        if (descriptor.readiness === 'unavailable') {
          return {
            status: 'unavailable',
            code: 'state_unavailable',
            message: 'Repository state is unavailable.',
            descriptor,
          };
        }
        const snapshot = await buildHostWorkspaceSnapshot(
          workspaceRoot,
          descriptor,
        );
        resolvedDescriptors.set(descriptor.snapshotId, descriptor);
        const repositoryIntelligence = loadRepositoryIntelligence(
          workspaceRoot,
          descriptor,
        );
        return {
          status: 'resolved',
          artifacts: {
            descriptor,
            snapshot,
            ...repositoryIntelligence,
          },
        };
      },
    },
    retriever: createHostRetriever({
      workspaceRoot,
      textIndexDatabasePath,
      openDatabase: options.openDatabase,
      resolvedDescriptors,
      semanticIndex: options.semanticIndex,
    }),
    selector,
    assembler: createHostAssembler(defaultAssembler),
  });
}

function loadRepositoryIntelligence(
  workspaceRoot: string,
  descriptor: RepositoryStateDescriptor,
): {
  repoGraph?: RepoGraph;
  repoMap?: RepoMap;
} {
  const root = descriptor.roots.find(
    (candidate: RepositoryRootState) =>
      candidate.graphRevision || candidate.mapRevision,
  );
  if (!root) return {};
  const artifactRoot = safeArtifactName(root.rootId);
  const graphPath = join(workspaceRoot, '.mitii', `repository-graph-${artifactRoot}.json`);
  const mapPath = join(workspaceRoot, '.mitii', `repository-map-${artifactRoot}.json`);
  const repoGraph = root.graphRevision ? readJsonArtifact(graphPath, repoGraphSchema) : undefined;
  const repoMap = root.mapRevision ? readJsonArtifact(mapPath, repoMapSchema) : undefined;
  return {
    ...(repoGraph ? { repoGraph } : {}),
    ...(repoMap ? { repoMap } : {}),
  };
}

function readJsonArtifact<T>(
  path: string,
  schema: { parse(input: unknown): T },
): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return schema.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return undefined;
  }
}

function safeArtifactName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, '_');
}

function createHostRetriever(options: {
  workspaceRoot: string;
  textIndexDatabasePath: string;
  openDatabase: OpenHostSqliteDatabase;
  resolvedDescriptors: ReadonlyMap<string, RepositoryStateDescriptor>;
  semanticIndex?: SemanticIndexSettings;
}): RepositoryContextRetrieverPort {
  return {
    retrieve: async (
      input: HybridRetrievalInput,
    ): Promise<HybridRetrievalResult> => {
      const descriptor = input.workspaceSnapshotId
        ? options.resolvedDescriptors.get(input.workspaceSnapshotId)
        : undefined;
      if (!descriptor || !hasUsableTextIndex(descriptor)) {
        return emptyHostRetrieval(
          input.query,
          'Pinned repository state does not expose a ready text index; using workspace file map fallback.',
        );
      }
      if (!existsSync(options.textIndexDatabasePath)) {
        return emptyHostRetrieval(
          input.query,
          'SQLite text index database is not present; using workspace file map fallback.',
        );
      }

      const vectorRuntime = await resolveVectorRetrievalRuntime({
        workspaceRoot: options.workspaceRoot,
        descriptor,
        semanticIndex: options.semanticIndex,
      });
      const database = options.openDatabase(options.textIndexDatabasePath, {
        readonly: true,
        fileMustExist: true,
      });
      let retrievalClose: (() => Promise<void>) | undefined;
      try {
        const runtime =
          vectorRuntime.status === 'ready'
            ? createWorkspaceRetrievalRuntime({
                textIndexDatabase: database as never,
                vector: vectorRuntime.vector,
              })
            : createWorkspaceRetrievalRuntime({
                textIndexDatabase: database as never,
              });
        retrievalClose = () => runtime.close();
        const retriever = new HybridRetrievalFactory().create({
          textIndex: runtime.textIndex,
          ...(runtime.vectorIndex && runtime.embeddingProvider
            ? {
                vectorIndex: runtime.vectorIndex,
                embeddingProvider: runtime.embeddingProvider,
              }
            : {}),
        });
        const result = await retriever.retrieve(input);
        return {
          ...result,
          warnings: [
            ...result.warnings,
            ...(vectorRuntime.status === 'ready'
              ? []
              : [
                  {
                    code: 'required_source_unavailable' as const,
                    message: vectorRuntime.reason,
                  },
                ]),
          ],
        };
      } catch (error) {
        return emptyHostRetrieval(
          input.query,
          `SQLite text retrieval failed; using workspace file map fallback: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      } finally {
        await retrievalClose?.().catch(() => undefined);
        database.close();
      }
    },
  };
}

async function resolveVectorRetrievalRuntime(options: {
  workspaceRoot: string;
  descriptor: RepositoryStateDescriptor;
  semanticIndex?: SemanticIndexSettings;
}): Promise<
  | {
      status: 'ready';
      vector: {
        embeddingProvider: OpenAiCompatibleEmbeddingProvider;
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
      reason: 'Vector retrieval is unavailable: semantic index is disabled or not configured.',
    };
  }
  const metadata = readIndexRuntimeMetadata(
    join(options.workspaceRoot, '.mitii', 'index-runtime.json'),
  );
  if (!metadata) {
    return {
      status: 'unavailable',
      reason: 'Vector retrieval is unavailable: index-runtime.json is missing or invalid.',
    };
  }
  if (
    !descriptorHasReadyVectorProfile(
      options.descriptor,
      metadata.embeddingProfile.id,
    )
  ) {
    return {
      status: 'unavailable',
      reason:
        'Vector retrieval is unavailable: published repository state does not expose the persisted vector profile.',
    };
  }
  const provider = new OpenAiCompatibleEmbeddingProvider(options.semanticIndex);
  if (provider.profile.id !== metadata.embeddingProfile.id) {
    return {
      status: 'unavailable',
      reason:
        'Vector retrieval is unavailable: current embedding profile differs from the profile that wrote LanceDB.',
    };
  }
  try {
    return {
      status: 'ready',
      vector: {
        embeddingProvider: provider,
        lanceConnection: await createLanceDbConnection(metadata.lanceDbPath),
      },
    };
  } catch (error) {
    return {
      status: 'unavailable',
      reason: `Vector retrieval is unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function descriptorHasReadyVectorProfile(
  descriptor: RepositoryStateDescriptor,
  profileId: string,
): boolean {
  return descriptor.roots.some(
    (root: RepositoryRootState) =>
      root.vectorProfile === profileId &&
      root.capabilities.some(
        (capability: RepositoryCapabilityStatus) =>
          capability.capability === 'vectorIndex' &&
          capability.status === 'ready',
      ),
  );
}

function createHostAssembler(
  defaultAssembler: RepositoryContextAssemblerPort,
): RepositoryContextAssemblerPort {
  return {
    assemble: async (
      input: ContextAssemblyInput,
    ): Promise<ContextAssemblyResult> => {
      if (input.selection.items.length > 0) {
        return defaultAssembler.assemble(input);
      }
      return assembleFileMapFallback(input);
    },
  };
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
        code: 'required_source_unavailable' as const,
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

function assembleFileMapFallback(
  input: ContextAssemblyInput,
): ContextAssemblyResult {
  const paths = input.snapshot.entries
    .filter(
      (entry: unknown): entry is WorkspaceFileEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        'kind' in entry &&
        entry.kind === 'file',
    )
    .map((entry: WorkspaceFileEntry) => entry.relativePath)
    .slice(0, MAX_REPO_MAP_FILES);
  let content = `Workspace file map (${paths.length} files):\n${paths
    .map((path: string) => `- ${path}`)
    .join('\n')}`;
  if (content.length > MAX_REPO_MAP_CHARS) {
    content = `${content.slice(0, MAX_REPO_MAP_CHARS)}\n...(truncated)`;
  }
  const truncated = content.includes('...(truncated)');
  const tokens = Math.max(1, Math.ceil(content.length / 4));
  return {
    schemaVersion: 1 as const,
    workspaceSnapshotId: input.snapshot.snapshotId,
    selectionStatus: input.selection.status,
    status: 'complete' as const,
    blocks: [
      {
        id: 'host_repo_map',
        trust: 'untrusted_repository_content' as const,
        sourceId: 'vscode_host',
        relativePath: 'repo-map.txt',
        requestedRepresentation: 'file_outline' as const,
        representation: 'file_outline' as const,
        content,
        lineRanges: [],
        allocatedTokens: tokens,
        tokenEstimate: tokens,
        truncated,
        omittedCharacters: 0,
        redactions: [],
        provenance: {
          selectionKey: 'host_repo_map',
          selectionOrder: 0,
          origins: ['retrieval' as const],
          priority: 'preferred' as const,
          score: 1,
          signals: [],
          retrievalSourceIds: [],
        },
      },
    ],
    dropped: [],
    warnings: [],
    budget: {
      allocatedTokens: tokens,
      usedTokens: tokens,
      remainingTokens: 0,
    },
    statistics: {
      selectedItems: 0,
      attemptedItems: 1,
      assembledBlocks: 1,
      droppedBlocks: 0,
      loadedFiles: 0,
      loadedRoots: 0,
      truncatedBlocks: truncated ? 1 : 0,
      fallbackBlocks: 1,
      redactedBlocks: 0,
      redactionCount: 0,
      inputCharacters: content.length,
      outputCharacters: content.length,
    },
  };
}

async function buildHostWorkspaceSnapshot(
  workspaceRoot: string,
  descriptor: RepositoryStateDescriptor,
): Promise<WorkspaceSnapshot> {
  const files: Array<{ relativePath: string; size: number; depth: number }> =
    [];
  let truncated = false;

  async function walk(dir: string): Promise<void> {
    if (truncated) return;
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (truncated) return;
      if (WORKSPACE_WALK_SKIP_DIR_NAMES.has(name)) continue;
      const full = join(dir, name);
      let info;
      try {
        info = await stat(full);
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!info.isFile()) continue;
      const relativePath = relative(workspaceRoot, full).replace(/\\/g, '/');
      if (!relativePath || relativePath.startsWith('..')) continue;
      files.push({
        relativePath,
        size: info.size,
        depth: relativePath.split('/').length,
      });
      if (files.length >= MAX_REPO_MAP_FILES) {
        truncated = true;
        return;
      }
    }
  }

  await walk(workspaceRoot);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const snapshotId = HEX_SNAPSHOT_ID.test(descriptor.snapshotId)
    ? descriptor.snapshotId
    : createFallbackSnapshotId(descriptor, files);

  // Pin to the published descriptor id when it is a schema-valid artifact id.
  return {
    schemaVersion: 1 as const,
    snapshotId,
    roots: [
      {
        id: 'workspace',
        name: 'workspace',
        kind: 'directory' as const,
        providerPath: workspaceRoot,
      },
    ],
    entries: files.map((f) => ({
      kind: 'file' as const,
      rootId: 'workspace',
      relativePath: f.relativePath,
      providerPath: join(workspaceRoot, f.relativePath),
      depth: f.depth,
      size: f.size,
    })),
    warnings: [],
    statistics: {
      files: files.length,
      directories: 0,
      symbolicLinks: 0,
      otherEntries: 0,
      ignoredEntries: 0,
      warnings: 0,
      durationMs: 0,
    },
    limits: {
      maximumDepth: 32,
      maximumFiles: MAX_REPO_MAP_FILES,
      maximumDirectories: 2_000,
      timeoutMs: 30_000,
      followSymbolicLinks: false,
    },
    status: truncated ? 'partial' : 'complete',
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  } satisfies WorkspaceSnapshot;
}

function createFallbackSnapshotId(
  descriptor: RepositoryStateDescriptor,
  files: Array<{ relativePath: string; size: number; depth: number }>,
): string {
  const payload = [
    descriptor.workspaceId,
    descriptor.snapshotId,
    ...files.map((file) => `${file.relativePath}:${file.size}:${file.depth}`),
  ].join('\n');
  return createHash('sha256').update(payload).digest('hex');
}
