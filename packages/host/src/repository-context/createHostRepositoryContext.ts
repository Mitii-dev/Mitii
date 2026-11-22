import { join } from 'node:path';
import {
  ContextAssemblyFactory,
  ContextSelector,
  NodeFileSystemAdapter,
  type RepositoryContextPipeline,
  type GitPort,
  type RepoMap,
  type RepositoryContextPipelineDependencies,
  type RepositoryContextSelectorPort,
  type RepositoryStateDescriptor,
  type RepositoryStatePipeline,
  type RepositoryStateReference,
  type CrossEncoderDocumentScorer,
} from '@mitii/v8';
import type { SemanticIndexSettings } from '../indexing/semanticIndex.js';
import type { OpenHostSqliteDatabase } from '../sqlite/types.js';
import { buildHostWorkspaceSnapshot } from './buildHostWorkspaceSnapshot.js';
import { createHostAssembler } from './createHostAssembler.js';
import { createHostRetriever } from './createHostRetriever.js';
import { GitAwareRepositoryContextPipeline } from './gitAwareRepositoryContextPipeline.js';
import type { HostEditorContextReferences } from './hostContextReferences.js';
import { resolveHostInjectionLimits } from './hostInjectionLimits.js';
import { loadRepositoryIntelligence } from './hostRepositoryIntelligence.js';

export type { HostEditorContextReferences } from './hostContextReferences.js';

const INDEX_DB_FILE = 'repository-index.sqlite';

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
  git?: GitPort;
  includeUntrackedGitFiles?: boolean;
  maximumGitDiffFiles?: number;
  /**
   * Opt-in corpus RAG (`.mitii/corpus/`). Default false.
   * Only registers when enabled AND `.mitii/corpus/index.json` exists.
   */
  corpusEnabled?: boolean;
  /**
   * Optional cross-encoder / API rerank scorer.
   * When omitted, host keeps the cheap identifier-aware lexical reranker.
   */
  crossEncoderScorer?: CrossEncoderDocumentScorer;
  resolveEditorReferences?: () =>
    | HostEditorContextReferences
    | Promise<HostEditorContextReferences>;
  /**
   * Window Budget–derived injection ceilings (`WindowPolicy.injection`).
   * When omitted, falls back to historical fixed caps.
   */
  injection?: {
    repoMapChars?: number;
    repoMapFilesMax?: number;
    sketchChars?: number;
    sketchItemsMax?: number;
  };
}): RepositoryContextPipeline {
  const { repositoryState, workspaceRoot } = options;
  const injectionLimits = resolveHostInjectionLimits(options.injection);
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
      corpusEnabled: options.corpusEnabled === true,
      ...(options.crossEncoderScorer
        ? { crossEncoderScorer: options.crossEncoderScorer }
        : {}),
    }),
    selector,
    assembler: createHostAssembler(
      defaultAssembler,
      (snapshotId) => resolvedRepoMaps.get(snapshotId),
      injectionLimits,
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
