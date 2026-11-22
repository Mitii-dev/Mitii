import type {
  RepositoryContextPipelineInput,
  RepositoryStateDescriptor,
} from '@mitii/v8';

export const DEFAULT_CONTEXT_ROOT_ID = 'workspace';

export type HostContextSelectionReferences = NonNullable<
  RepositoryContextPipelineInput['references']
>;
export type HostContextFileReference = NonNullable<
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
  recentEditFiles?: readonly HostContextFileReference[];
  /**
   * Files changed on disk after the agent last loaded them (Cline-style).
   * Injected as preferred selection priors so re-read beats stale bodies.
   */
  staleFiles?: readonly HostContextFileReference[];
};

export function resolveDefaultContextRootId(
  descriptor: RepositoryStateDescriptor,
): string {
  return (
    descriptor.roots.find((root) => root.rootId === DEFAULT_CONTEXT_ROOT_ID)
      ?.rootId ??
    descriptor.roots[0]?.rootId ??
    DEFAULT_CONTEXT_ROOT_ID
  );
}

export function toContextFileReferences(
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

export function normalizeContextFileReference(
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

export function mergeContextReferences(
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
    ...(additions.recentEditFiles
      ? {
          recentEditFiles: uniqueContextFileReferences([
            ...(existing?.recentEditFiles ?? []),
            ...additions.recentEditFiles,
          ]),
        }
      : {}),
    ...(additions.staleFiles
      ? {
          staleFiles: uniqueContextFileReferences([
            ...(existing?.staleFiles ?? []),
            ...additions.staleFiles,
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
