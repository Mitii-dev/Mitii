import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  ContextAssemblyFactory,
  ContextSelector,
  HybridRetrievalFactory,
  IdentifierAwareRetrievalReranker,
  NodeFileSystemAdapter,
  RepositoryContextPipeline,
  type GitPort,
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
  type RepositoryContextPipelineDependencies,
  type RepositoryContextPipelineInput,
  type RepositoryContextPipelineResult,
  type RepositoryRootState,
  type WorkspaceFileEntry,
  type WorkspaceSnapshot,
  type EmbeddingProvider,
  pathMatchesFolderPrefix,
} from '@mitii/v8';
import {
  alignSemanticSettingsWithPersistedProfile,
  createLanceDbConnection,
  readIndexRuntimeMetadata,
  resolveHostEmbeddingProvider,
  type SemanticIndexSettings,
} from '../indexing/semanticIndex.js';
import { WORKSPACE_WALK_SKIP_DIR_NAMES, shouldSkipWorkspaceWalkFile } from '../internal/workspaceWalk.js';
import type { OpenHostSqliteDatabase } from '../sqlite/types.js';

const MAX_REPO_MAP_FILES = 400;
const MAX_WORKSPACE_SNAPSHOT_FILES = 10_000;
const MAX_REPO_MAP_CHARS = 24_000;
const INDEX_DB_FILE = 'repository-index.sqlite';
const HEX_SNAPSHOT_ID = /^[a-f0-9]{64}$/;
const DEFAULT_CONTEXT_ROOT_ID = 'workspace';

type HostContextSelectionReferences = NonNullable<
  RepositoryContextPipelineInput['references']
>;
type HostContextFileReference = NonNullable<
  HostContextSelectionReferences['gitDiffFiles']
>[number];

/**
 * Host-side Repository Context shared by VS Code and CLI.
 * Resolves published state + injects a file-tree block so repository routes
 * can proceed and the model can see the workspace layout.
 */
export type HostEditorContextReferences = {
  currentFile?: HostContextFileReference;
  openFiles?: readonly HostContextFileReference[];
};

export function createHostRepositoryContext(options: {
  repositoryState: RepositoryStatePipeline;
  workspaceRoot: string;
  openDatabase: OpenHostSqliteDatabase;
  textIndexDatabasePath?: string;
  semanticIndex?: SemanticIndexSettings;
  git?: GitPort;
  includeUntrackedGitFiles?: boolean;
  maximumGitDiffFiles?: number;
  resolveEditorReferences?: () =>
    | HostEditorContextReferences
    | Promise<HostEditorContextReferences>;
}): RepositoryContextPipeline {
  const { repositoryState, workspaceRoot } = options;
  const textIndexDatabasePath =
    options.textIndexDatabasePath ?? join(workspaceRoot, '.mitii', INDEX_DB_FILE);
  const resolvedDescriptors = new Map<string, RepositoryStateDescriptor>();
  const resolvedRepoMaps = new Map<string, RepoMap>();
  const selector: RepositoryContextSelectorPort = new ContextSelector();
  const defaultAssembler = new ContextAssemblyFactory().create({
    fileSystem: new NodeFileSystemAdapter(),
  });

  const dependencies: RepositoryContextPipelineDependencies = {
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
        if (repositoryIntelligence.repoMap) {
          resolvedRepoMaps.set(descriptor.snapshotId, repositoryIntelligence.repoMap);
        }
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
    assembler: createHostAssembler(defaultAssembler, (snapshotId) =>
      resolvedRepoMaps.get(snapshotId),
    ),
  };

  return new GitAwareRepositoryContextPipeline(dependencies, {
    git: options.git,
    repositoryState,
    workspaceRoot,
    includeUntrackedGitFiles: options.includeUntrackedGitFiles === true,
    maximumGitDiffFiles: options.maximumGitDiffFiles ?? 200,
    resolveEditorReferences: options.resolveEditorReferences,
  });
}

class GitAwareRepositoryContextPipeline extends RepositoryContextPipeline {
  public constructor(
    dependencies: RepositoryContextPipelineDependencies,
    private readonly options: {
      git?: GitPort;
      repositoryState: RepositoryStatePipeline;
      workspaceRoot: string;
      includeUntrackedGitFiles: boolean;
      maximumGitDiffFiles: number;
      resolveEditorReferences?: () =>
        | HostEditorContextReferences
        | Promise<HostEditorContextReferences>;
    },
  ) {
    super(dependencies);
  }

  public override async execute(
    input: RepositoryContextPipelineInput,
  ): Promise<RepositoryContextPipelineResult> {
    const { input: enriched, warnings } = await this.enrichInput(input);
    const result = await super.execute(enriched);
    if (warnings.length === 0) {
      return result;
    }
    return {
      ...result,
      warnings: [...result.warnings, ...warnings],
    };
  }

  private async enrichInput(
    input: RepositoryContextPipelineInput,
  ): Promise<{
    input: RepositoryContextPipelineInput;
    warnings: RepositoryContextPipelineResult['warnings'];
  }> {
    const warnings: RepositoryContextPipelineResult['warnings'] = [];
    let next = input;
    const descriptorRead = await this.options.repositoryState.read(input.state);
    const rootId =
      descriptorRead.status === 'found'
        ? resolveDefaultContextRootId(descriptorRead.descriptor)
        : DEFAULT_CONTEXT_ROOT_ID;

    if (this.options.resolveEditorReferences) {
      try {
        const editor = await this.options.resolveEditorReferences();
        const currentFile = editor.currentFile
          ? normalizeContextFileReference(editor.currentFile, rootId)
          : undefined;
        const openFiles = (editor.openFiles ?? [])
          .map((file) => normalizeContextFileReference(file, rootId))
          .filter((file): file is HostContextFileReference => Boolean(file));
        next = {
          ...next,
          references: mergeContextReferences(next.references, {
            ...(currentFile ? { currentFile } : {}),
            ...(openFiles.length ? { openFiles } : {}),
          }),
        };
      } catch {
        warnings.push({
          stage: 'selection',
          code: 'editor_references_unavailable',
          message: 'Editor tab references were unavailable for context selection.',
        });
      }
    }

    if (!this.options.git || this.options.maximumGitDiffFiles <= 0) {
      return { input: next, warnings };
    }

    if (descriptorRead.status !== 'found') {
      return { input: next, warnings };
    }

    let status;
    try {
      status = await this.options.git.status({
        workspaceRoot: this.options.workspaceRoot,
        signal: input.abortSignal,
      });
    } catch {
      warnings.push({
        stage: 'selection',
        code: 'git_status_unavailable',
        message: 'Git status was unavailable; dirty-file context priors were skipped.',
      });
      return { input: next, warnings };
    }

    const gitDiffFiles = toContextFileReferences(
      [
        ...status.staged,
        ...status.unstaged,
        ...(this.options.includeUntrackedGitFiles ? status.untracked : []),
      ],
      rootId,
      this.options.maximumGitDiffFiles,
    );

    if (gitDiffFiles.length === 0) {
      return { input: next, warnings };
    }

    return {
      input: {
        ...next,
        references: mergeContextReferences(next.references, {
          gitDiffFiles,
        }),
      },
      warnings,
    };
  }
}

function resolveDefaultContextRootId(
  descriptor: RepositoryStateDescriptor,
): string {
  return (
    descriptor.roots.find((root) => root.rootId === DEFAULT_CONTEXT_ROOT_ID)
      ?.rootId ??
    descriptor.roots[0]?.rootId ??
    DEFAULT_CONTEXT_ROOT_ID
  );
}

function toContextFileReferences(
  paths: readonly string[],
  rootId: string,
  maximumFiles: number,
): NonNullable<HostContextSelectionReferences['gitDiffFiles']> {
  const references: HostContextFileReference[] = [];
  const seen = new Set<string>();

  for (const path of paths) {
    const relativePath = normalizeGitStatusPath(path);
    if (!relativePath) continue;

    const key = `${rootId}\u0000${relativePath}`;
    if (seen.has(key)) continue;
    seen.add(key);

    references.push({
      rootId,
      relativePath,
    });

    if (references.length >= maximumFiles) {
      break;
    }
  }

  return references;
}

function normalizeContextFileReference(
  reference: HostContextFileReference,
  rootId: string,
): HostContextFileReference | undefined {
  const relativePath = normalizeGitStatusPath(reference.relativePath);
  if (!relativePath) return undefined;
  return {
    rootId: reference.rootId ?? rootId,
    relativePath,
  };
}

function mergeContextReferences(
  existing: HostContextSelectionReferences | undefined,
  additions: HostContextSelectionReferences,
): HostContextSelectionReferences {
  return {
    ...(existing ?? {}),
    ...(additions.currentFile
      ? { currentFile: additions.currentFile }
      : {}),
    ...(additions.openFiles
      ? {
          openFiles: uniqueContextFileReferences([
            ...(existing?.openFiles ?? []),
            ...additions.openFiles,
          ]),
        }
      : {}),
    ...(additions.gitDiffFiles
      ? {
          gitDiffFiles: uniqueContextFileReferences([
            ...(existing?.gitDiffFiles ?? []),
            ...additions.gitDiffFiles,
          ]),
        }
      : {}),
  };
}

function uniqueContextFileReferences(
  references: readonly HostContextFileReference[],
): NonNullable<HostContextSelectionReferences['gitDiffFiles']> {
  const seen = new Set<string>();
  const result: HostContextFileReference[] = [];

  for (const reference of references) {
    const relativePath = normalizeGitStatusPath(reference.relativePath);
    if (!relativePath) continue;

    const rootId = reference.rootId ?? '';
    const key = `${rootId}\u0000${relativePath}`;
    if (seen.has(key)) continue;
    seen.add(key);

    result.push({
      ...(reference.rootId ? { rootId: reference.rootId } : {}),
      relativePath,
    });
  }

  return result;
}

function normalizeGitStatusPath(path: string): string | undefined {
  const normalized = path.trim().replace(/\\/g, '/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.startsWith('../') ||
    normalized === '..' ||
    normalized.includes('\0')
  ) {
    return undefined;
  }

  return normalized
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.')
    .join('/');
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

        const retriever = new HybridRetrievalFactory().create({
          ...(textIndex ? { textIndex } : {}),
          reranker: new IdentifierAwareRetrievalReranker(),
          ...(vectorIndex && embeddingProvider
            ? {
                vectorIndex,
                embeddingProvider,
              }
            : {}),
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
  const vectorCapability = vectorCapabilityForProfile(
    options.descriptor,
    metadata.embeddingProfile.id,
  );
  if (!vectorCapability) {
    return {
      status: 'unavailable',
      reason:
        'Vector retrieval is unavailable (published_profile_missing): published repository state does not expose the persisted vector profile. Reindex the workspace.',
    };
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
    if (capability?.status === 'ready' || capability?.status === 'degraded') {
      return capability.status;
    }
  }
  return undefined;
}

function createHostAssembler(
  defaultAssembler: RepositoryContextAssemblerPort,
  getRepoMap: (snapshotId: string) => RepoMap | undefined,
): RepositoryContextAssemblerPort {
  return {
    assemble: async (
      input: ContextAssemblyInput,
    ): Promise<ContextAssemblyResult> => {
      const repoMap = getRepoMap(input.snapshot.snapshotId);
      if (input.selection.items.length === 0) {
        return assembleFileMapFallback(input, repoMap, 'empty_selection');
      }
      const assembled = await defaultAssembler.assemble(input);
      if (
        assembled.blocks.length > 0 ||
        assembled.status === 'cancelled' ||
        assembled.status === 'failed'
      ) {
        return assembled;
      }
      return mergeFailedAssemblyWithFileMapFallback(input, assembled, repoMap);
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

function mergeFailedAssemblyWithFileMapFallback(
  input: ContextAssemblyInput,
  assembled: ContextAssemblyResult,
  repoMap?: RepoMap,
): ContextAssemblyResult {
  const fallback = assembleFileMapFallback(input, repoMap, 'empty_assembly');
  return {
    ...fallback,
    dropped: [...assembled.dropped, ...fallback.dropped],
    warnings: [...assembled.warnings, ...fallback.warnings],
    statistics: {
      ...fallback.statistics,
      selectedItems: input.selection.items.length,
      attemptedItems:
        assembled.statistics.attemptedItems + fallback.statistics.attemptedItems,
      droppedBlocks: assembled.dropped.length + fallback.dropped.length,
    },
  };
}

function assembleFileMapFallback(
  input: ContextAssemblyInput,
  repoMap: RepoMap | undefined,
  reason: 'empty_selection' | 'empty_assembly',
): ContextAssemblyResult {
  const snapshotPaths = input.snapshot.entries
    .filter(
      (entry: unknown): entry is WorkspaceFileEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        'kind' in entry &&
        entry.kind === 'file',
    )
    .map((entry: WorkspaceFileEntry) => entry.relativePath);
  const rankedPaths = [...(repoMap?.entries ?? [])]
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.file.relativePath.localeCompare(right.file.relativePath),
    )
    .map((entry) => entry.file.relativePath);
  const folderPrefix = input.folderPrefix?.trim();
  const inFolder = (path: string): boolean =>
    folderPrefix ? pathMatchesFolderPrefix(path, folderPrefix) : true;
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const path of [...rankedPaths, ...snapshotPaths].filter(inFolder)) {
    if (seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
    if (paths.length >= MAX_REPO_MAP_FILES) break;
  }
  const ranked = rankedPaths.length > 0;
  let content = `Workspace file map (${paths.length} files${
    ranked ? ', ranked by repository map' : ''
  }):\n${paths.map((path: string) => `- ${path}`).join('\n')}`;
  if (content.length > MAX_REPO_MAP_CHARS) {
    content = `${content.slice(0, MAX_REPO_MAP_CHARS)}\n...(truncated)`;
  }
  const truncated =
    content.includes('...(truncated)') ||
    snapshotPaths.length > paths.length ||
    rankedPaths.length > paths.length;
  const tokens = Math.max(1, Math.ceil(content.length / 4));
  return {
    schemaVersion: 1 as const,
    workspaceSnapshotId: input.snapshot.snapshotId,
    selectionStatus: input.selection.status,
    status: 'partial' as const,
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
    warnings: [
      {
        code: 'file_map_fallback' as const,
        message: fileMapFallbackMessage(reason, ranked),
      },
    ],
    budget: {
      allocatedTokens: tokens,
      usedTokens: tokens,
      remainingTokens: 0,
    },
    statistics: {
      selectedItems:
        reason === 'empty_assembly' ? input.selection.items.length : 0,
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

function fileMapFallbackMessage(
  reason: 'empty_selection' | 'empty_assembly',
  ranked: boolean,
): string {
  if (reason === 'empty_assembly') {
    return ranked
      ? 'Selected context items assembled to zero file bodies; injected a repository-map-ranked file list instead of file contents.'
      : 'Selected context items assembled to zero file bodies; injected a workspace file list instead of file contents.';
  }
  return ranked
    ? 'Retrieval selected no items; assembled a repository-map-ranked file list instead of file contents.'
    : 'Retrieval selected no items; assembled a workspace file list instead of file contents.';
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
    for (const name of names.sort((a, b) => a.localeCompare(b))) {
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
      if (shouldSkipWorkspaceWalkFile(relativePath, name)) continue;
      files.push({
        relativePath,
        size: info.size,
        depth: relativePath.split('/').length,
      });
      if (files.length >= MAX_WORKSPACE_SNAPSHOT_FILES) {
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
  // Entries must use the same rootId as indexed retrieval candidates, or
  // WorkspaceFileContextSource drops every hit as content_not_found.
  const rootId = resolveDefaultContextRootId(descriptor);
  return {
    schemaVersion: 1 as const,
    snapshotId,
    roots: [
      {
        id: rootId,
        name: rootId,
        kind: 'directory' as const,
        providerPath: workspaceRoot,
      },
    ],
    entries: files.map((f) => ({
      kind: 'file' as const,
      rootId,
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
