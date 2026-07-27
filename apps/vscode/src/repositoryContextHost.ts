import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  RepositoryContextPipeline,
  type RepositoryStateDescriptor,
  type RepositoryStatePipeline,
  type RepositoryStateReference,
} from '@mitii/v8';

const SKIP_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.mitii',
  '.cursor',
]);

const MAX_REPO_MAP_FILES = 400;
const MAX_REPO_MAP_CHARS = 24_000;

/**
 * Host-side Repository Context that does not need vector/code indexes.
 * Resolves published state + injects a file-tree block so repository routes
 * can proceed and the model can see the workspace layout.
 */
export function createHostRepositoryContext(options: {
  repositoryState: RepositoryStatePipeline;
  workspaceRoot: string;
}): RepositoryContextPipeline {
  const { repositoryState, workspaceRoot } = options;

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
        return {
          status: 'resolved',
          artifacts: { descriptor, snapshot },
        };
      },
    },
    retriever: {
      retrieve: async (input: { query: string }) => ({
        schemaVersion: 1 as const,
        query: input.query,
        status: 'empty' as const,
        candidates: [],
        sourceReports: [],
        warnings: [
          {
            code: 'required_source_unavailable',
            message:
              'Host context uses workspace file map; full hybrid retrieval is not configured.',
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
      }),
    },
    selector: {
      select: (input: {
        query: string;
        mode?: 'ask' | 'plan' | 'agent';
        breadth?: string;
      }) => ({
        schemaVersion: 1 as const,
        query: input.query,
        mode: input.mode ?? 'ask',
        breadth: input.breadth ?? 'balanced',
        status: 'empty' as const,
        items: [],
        dropped: [],
        warnings: [],
        budget: {
          maximumTokens: 8_000,
          usedTokens: 0,
          remainingTokens: 8_000,
          maximumItems: 20,
          maximumFiles: 20,
          maximumItemsPerFile: 2,
        },
        statistics: {
          retrievedCandidates: 0,
          synthesizedReferences: 0,
          consideredCandidates: 0,
          selectedItems: 0,
          droppedItems: 0,
          selectedFiles: 0,
          selectedRoots: 0,
          requiredItems: 0,
          preferredItems: 0,
          supplementaryItems: 0,
          fullFileItems: 0,
          exactRangeItems: 0,
          targetedExcerptItems: 0,
          fileOutlineItems: 0,
          symbolSignatureItems: 0,
        },
      }),
    },
    assembler: {
      assemble: async (input: {
        snapshot: {
          snapshotId: string;
          entries: Array<{ kind: string; relativePath: string }>;
        };
        selection: { status: string };
      }) => {
        const paths = input.snapshot.entries
          .filter((e: { kind: string }) => e.kind === 'file')
          .map((e: { relativePath: string }) => e.relativePath)
          .slice(0, MAX_REPO_MAP_FILES);
        let content = `Workspace file map (${paths.length} files):\n${paths
          .map((p: string) => `- ${p}`)
          .join('\n')}`;
        if (content.length > MAX_REPO_MAP_CHARS) {
          content = `${content.slice(0, MAX_REPO_MAP_CHARS)}\n…(truncated)`;
        }
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
              truncated: content.includes('…(truncated)'),
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
            truncatedBlocks: content.includes('…(truncated)') ? 1 : 0,
            fallbackBlocks: 0,
            redactedBlocks: 0,
            redactionCount: 0,
            inputCharacters: content.length,
            outputCharacters: content.length,
          },
        };
      },
    },
  });
}

async function buildHostWorkspaceSnapshot(
  workspaceRoot: string,
  descriptor: RepositoryStateDescriptor,
) {
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
      if (SKIP_DIR_NAMES.has(name)) continue;
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

  // Pin to the published descriptor id — pipeline and assembly must agree.
  return {
    schemaVersion: 1,
    snapshotId: descriptor.snapshotId,
    roots: [
      {
        id: 'workspace',
        name: 'workspace',
        kind: 'directory',
        providerPath: workspaceRoot,
      },
    ],
    entries: files.map((f) => ({
      kind: 'file' as const,
      rootId: 'workspace',
      relativePath: f.relativePath,
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
  };
}
