import * as path from "node:path";

import type { ToolGrant } from "../../../modules/decision-policy";

import type { WorkspaceFileSystemPort } from "../contracts";
import {
  DEFAULT_GLOB_SKIP_DIRECTORY_NAMES,
  DEFAULT_MAX_GLOB_RESULTS,
} from "../defaults";
import { assertSafeGlobPattern, matchGlob } from "../internal/GlobMatch";
import {
  PathContainmentError,
  resolveContainedPath,
  resolveScopedSearchPath,
} from "../internal/PathContainment";
import {
  globFilesInputSchema,
  globFilesOutputSchema,
} from "../internal/ToolCatalog";

export async function executeGlobFiles(params: {
  arguments: unknown;
  grant: ToolGrant;
  workspaceRoot: string;
  fileSystem: WorkspaceFileSystemPort;
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
  const input = globFilesInputSchema.parse(params.arguments);
  try {
    assertSafeGlobPattern(input.pattern);
  } catch (error) {
    throw new PathContainmentError(
      "invalid_arguments",
      error instanceof Error ? error.message : "Invalid glob pattern.",
    );
  }

  const contained = await resolveContainedPath({
    fileSystem: params.fileSystem,
    workspaceRoot: params.workspaceRoot,
    requestedPath: resolveScopedSearchPath({
      requestedPath: input.path,
      pattern: input.pattern,
      pathScopes: params.grant.pathScopes,
    }),
    pathScopes: params.grant.pathScopes,
  });

  const maxResults = input.maxResults ?? DEFAULT_MAX_GLOB_RESULTS;
  const skipDirs = new Set<string>(DEFAULT_GLOB_SKIP_DIRECTORY_NAMES);
  const matches: Array<{
    path: string;
    kind: "file" | "directory" | "symlink" | "other";
  }> = [];
  let truncated = false;

  const walk = async (absoluteDir: string, relativeDir: string): Promise<void> => {
    if (matches.length >= maxResults) {
      truncated = true;
      return;
    }
    const entries = await params.fileSystem.listDirectory(absoluteDir);
    for (const entry of entries) {
      if (matches.length >= maxResults) {
        truncated = true;
        return;
      }
      if (entry.kind === "directory" && skipDirs.has(entry.name)) {
        continue;
      }
      const relativePath =
        relativeDir === "." ? entry.name : `${relativeDir}/${entry.name}`;
      if (!isPathWithinGrant(relativePath, params.grant.pathScopes)) {
        continue;
      }
      if (matchGlob(relativePath, input.pattern)) {
        matches.push({ path: relativePath, kind: entry.kind });
        if (matches.length >= maxResults) {
          truncated = true;
          return;
        }
      }
      if (entry.kind === "directory") {
        await walk(
          path.join(absoluteDir, entry.name),
          relativePath,
        );
      }
    }
  };

  const rootStat = await params.fileSystem.lstat(contained.realPath);
  if (rootStat.kind === "file" || rootStat.kind === "symlink") {
    if (matchGlob(contained.relativePath, input.pattern)) {
      matches.push({
        path: contained.relativePath,
        kind: rootStat.kind,
      });
    }
  } else {
    await walk(contained.realPath, contained.relativePath);
  }

  const output = globFilesOutputSchema.parse({
    pattern: input.pattern,
    path: contained.relativePath,
    matches,
    truncated,
  });

  return { output, truncated, redacted: false };
}

function isPathWithinGrant(
  relativePath: string,
  pathScopes: readonly string[],
): boolean {
  if (pathScopes.includes(".")) {
    return true;
  }
  return pathScopes.some(
    (scope) =>
      relativePath === scope || relativePath.startsWith(`${scope}/`),
  );
}
