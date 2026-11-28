/**
 * Shared Orient situation gather for every host via prepareStartInput.
 */

import type { MitiiStartInput } from '@mitii/sdk';

import { createNodeJsDiagnosticsPort } from '../code-navigation/createNodeJsDiagnosticsPort.js';
import { createHostGitPort } from '../ports/createHostGitPort.js';
import { readWorkspaceCatalogSlice } from './readWorkspaceCatalogSlice.js';

export interface BuildRuntimeSituationInput {
  workspaceRoot?: string;
  focusedFile?: string;
  cwd?: string;
  dirtyPaths?: readonly string[];
  diagnostics?: readonly string[];
  selection?: {
    path: string;
    startLine?: number;
    endLine?: number;
  };
  projectRuleIds?: readonly string[];
  /** Injected git for tests; default createHostGitPort(). */
  gitPort?: ReturnType<typeof createHostGitPort>;
  /** Skip disk/git I/O (unit tests). */
  skipGather?: boolean;
  /** Skip Node soft diagnostics when host already supplied none. */
  skipDiagnostics?: boolean;
}

/**
 * Build MitiiStartInput.runtimeSituation (+ dirtyPaths) for runtime Orient.
 */
export async function buildRuntimeSituation(
  input: BuildRuntimeSituationInput,
): Promise<{
  runtimeSituation: NonNullable<MitiiStartInput['runtimeSituation']>;
  dirtyPaths?: string[];
}> {
  const root = input.workspaceRoot?.trim() || undefined;
  const seedDirty = [...(input.dirtyPaths ?? [])].filter(Boolean);
  let dirtyPaths = [...new Set(seedDirty)].slice(0, 64);
  let branch: string | undefined;
  let dirty = dirtyPaths.length > 0;

  if (root && !input.skipGather) {
    try {
      const git = input.gitPort ?? createHostGitPort({ forceCli: true });
      const status = await git.status({ workspaceRoot: root });
      branch = status.branch;
      const fromGit = [
        ...status.staged,
        ...status.unstaged,
        ...status.untracked,
      ];
      dirtyPaths = [...new Set([...dirtyPaths, ...fromGit])].slice(0, 64);
      dirty = dirtyPaths.length > 0;
    } catch {
      // keep seed dirty only
    }
  }

  let catalog: NonNullable<MitiiStartInput['runtimeSituation']>['catalog'];
  if (root && !input.skipGather) {
    const slice = await readWorkspaceCatalogSlice(root);
    if (slice) {
      catalog = {
        projects: slice.projects,
        configPointers: slice.configPointers,
        ...(slice.relationships.length > 0
          ? { relationships: slice.relationships }
          : {}),
      };
    }
  }

  let diagnostics = [...(input.diagnostics ?? [])].slice(0, 32);
  if (
    diagnostics.length === 0 &&
    root &&
    input.focusedFile &&
    !input.skipGather &&
    !input.skipDiagnostics
  ) {
    diagnostics = await softNodeDiagnostics(root, input.focusedFile);
  }

  const runtimeSituation: NonNullable<MitiiStartInput['runtimeSituation']> = {
    host: {
      ...(input.focusedFile ? { focusedFile: input.focusedFile } : {}),
      cwd: input.cwd ?? root,
      dirtyPaths,
      diagnostics,
      ...(input.selection ? { selection: input.selection } : {}),
    },
    ...(branch !== undefined || dirty
      ? {
          git: {
            ...(branch ? { branch } : {}),
            dirty,
            recentCommits: [],
          },
        }
      : {}),
    ...(catalog ? { catalog } : {}),
    ...(input.projectRuleIds && input.projectRuleIds.length > 0
      ? { projectRuleIds: [...input.projectRuleIds].slice(0, 32) }
      : {}),
  };

  return {
    runtimeSituation,
    ...(dirtyPaths.length > 0 ? { dirtyPaths } : {}),
  };
}

async function softNodeDiagnostics(
  workspaceRoot: string,
  focusedFile: string,
): Promise<string[]> {
  if (!/\.(js|mjs|cjs)$/i.test(focusedFile)) return [];
  try {
    const port = createNodeJsDiagnosticsPort({ workspaceRoot });
    const items = await port.readDiagnostics({
      workspaceRoot,
      paths: [focusedFile],
    });
    return items
      .slice(0, 12)
      .map((item) => {
        const line =
          typeof item.startLine === 'number' ? `L${item.startLine}: ` : '';
        return `${line}${item.message}`;
      });
  } catch {
    return [];
  }
}
