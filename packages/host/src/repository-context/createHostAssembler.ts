import {
  pathMatchesFolderPrefix,
  type ContextAssemblyInput,
  type ContextAssemblyResult,
  type RepoMap,
  type RepositoryContextAssemblerPort,
  type WorkspaceFileEntry,
} from '@mitii/v8';
import type { HostInjectionLimits } from './hostInjectionLimits.js';
import { buildWorkspaceSketch } from './workspaceSketch.js';

export function createHostAssembler(
  defaultAssembler: RepositoryContextAssemblerPort,
  getRepoMap: (snapshotId: string) => RepoMap | undefined,
  injectionLimits: HostInjectionLimits,
): RepositoryContextAssemblerPort {
  return {
    assemble: async (
      input: ContextAssemblyInput,
    ): Promise<ContextAssemblyResult> => {
      const repoMap = getRepoMap(input.snapshot.snapshotId);
      if (input.selection.items.length === 0) {
        return assembleFileMapFallback(
          input,
          repoMap,
          'empty_selection',
          injectionLimits,
        );
      }
      const assembled = await defaultAssembler.assemble(input);
      if (
        assembled.blocks.length > 0 ||
        assembled.status === 'cancelled' ||
        assembled.status === 'failed'
      ) {
        return assembled;
      }
      return mergeFailedAssemblyWithFileMapFallback(
        input,
        assembled,
        repoMap,
        injectionLimits,
      );
    },
  };
}

function mergeFailedAssemblyWithFileMapFallback(
  input: ContextAssemblyInput,
  assembled: ContextAssemblyResult,
  repoMap: RepoMap | undefined,
  injectionLimits: HostInjectionLimits,
): ContextAssemblyResult {
  const fallback = assembleFileMapFallback(
    input,
    repoMap,
    'empty_assembly',
    injectionLimits,
  );
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
  injectionLimits: HostInjectionLimits,
): ContextAssemblyResult {
  const { repoMapFilesMax, sketchItemsMax, sketchChars } = injectionLimits;
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
    if (paths.length >= repoMapFilesMax) break;
  }
  const ranked = rankedPaths.length > 0;
  const sketch = buildWorkspaceSketch(paths, {
    maximumItems: sketchItemsMax,
    maximumCharacters: sketchChars,
    rootLabel: '.',
  });
  const content = ranked
    ? `Workspace sketch (${sketch.includedItems} items, ranked seeds):\n${sketch.content}`
    : `Workspace sketch (${sketch.includedItems} items):\n${sketch.content}`;
  const truncated =
    sketch.truncated ||
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
      ? 'Selected context items assembled to zero file bodies; injected a repository-map-ranked workspace sketch instead of file contents.'
      : 'Selected context items assembled to zero file bodies; injected a BFS workspace sketch instead of file contents.';
  }
  return ranked
    ? 'Retrieval selected no items; assembled a repository-map-ranked workspace sketch instead of file contents.'
    : 'Retrieval selected no items; assembled a BFS workspace sketch instead of file contents.';
}
