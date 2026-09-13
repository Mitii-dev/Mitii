import type { ToolGrant } from "../../../modules/decision-policy";

import type {
  WorkspaceDirectoryEntry,
  WorkspaceFileSystemPort,
} from "../contracts";
import {
  DEFAULT_GLOB_SKIP_DIRECTORY_NAMES,
  DEFAULT_MAX_GLOB_RESULTS,
} from "../defaults";
import {
  PathContainmentError,
  resolveContainedPath,
} from "../internal/PathContainment";
import {
  directoryTreeInputSchema,
  directoryTreeOutputSchema,
} from "../internal/ToolCatalog";

export interface DirectoryTreeNode {
  name: string;
  kind: WorkspaceDirectoryEntry["kind"];
  children?: DirectoryTreeNode[];
}

const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_ENTRIES = DEFAULT_MAX_GLOB_RESULTS * 10;

export async function executeDirectoryTree(params: {
  arguments: unknown;
  grant: ToolGrant;
  workspaceRoot: string;
  fileSystem: WorkspaceFileSystemPort;
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
  const input = directoryTreeInputSchema.parse(params.arguments);
  const contained = await resolveContainedPath({
    fileSystem: params.fileSystem,
    workspaceRoot: params.workspaceRoot,
    requestedPath: input.path,
    pathScopes: params.grant.pathScopes,
  });

  const maxDepth = input.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxEntries = input.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const skipNames = new Set<string>([
    ...DEFAULT_GLOB_SKIP_DIRECTORY_NAMES,
    ...(input.excludeNames ?? []),
  ]);

  let entryCount = 0;
  let truncated = false;

  const walk = async (
    absoluteDir: string,
    relativeDir: string,
    depth: number,
  ): Promise<DirectoryTreeNode[]> => {
    if (truncated || entryCount >= maxEntries) {
      truncated = true;
      return [];
    }
    if (depth > maxDepth) {
      truncated = true;
      return [];
    }

    let entries: WorkspaceDirectoryEntry[];
    try {
      entries = await params.fileSystem.listDirectory(absoluteDir);
    } catch {
      return [];
    }

    const nodes: DirectoryTreeNode[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entryCount >= maxEntries) {
        truncated = true;
        break;
      }
      if (entry.kind === "directory" && skipNames.has(entry.name)) {
        continue;
      }
      if (skipNames.has(entry.name) && entry.kind !== "directory") {
        continue;
      }

      const relativePath =
        relativeDir === "." ? entry.name : `${relativeDir}/${entry.name}`;
      if (!isWithinScopes(relativePath, params.grant.pathScopes)) {
        continue;
      }

      entryCount += 1;
      if (entry.kind === "directory") {
        const childAbsolute = params.fileSystem.resolve(
          absoluteDir,
          entry.name,
        );
        const children =
          depth < maxDepth
            ? await walk(childAbsolute, relativePath, depth + 1)
            : undefined;
        if (depth >= maxDepth) {
          truncated = true;
        }
        nodes.push({
          name: entry.name,
          kind: entry.kind,
          ...(children && children.length > 0 ? { children } : {}),
        });
      } else {
        nodes.push({ name: entry.name, kind: entry.kind });
      }
    }
    return nodes;
  };

  let tree: DirectoryTreeNode[];
  try {
    const stat = await params.fileSystem.lstat(contained.realPath);
    if (stat.kind !== "directory") {
      throw new PathContainmentError(
        "invalid_arguments",
        `directory_tree requires a directory path, got "${contained.relativePath}".`,
      );
    }
    tree = await walk(contained.realPath, contained.relativePath, 1);
  } catch (error) {
    if (error instanceof PathContainmentError) {
      throw error;
    }
    throw error;
  }

  const output = directoryTreeOutputSchema.parse({
    path: contained.relativePath,
    tree,
    truncated,
    entryCount,
  });

  return { output, truncated, redacted: false };
}

function isWithinScopes(
  relativePath: string,
  pathScopes: readonly string[],
): boolean {
  for (const scope of pathScopes) {
    if (scope === "." || scope === "") return true;
    if (relativePath === scope || relativePath.startsWith(`${scope}/`)) {
      return true;
    }
  }
  return false;
}
