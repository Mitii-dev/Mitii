import type { ToolGrant } from "../../decision-policy";

import type { WorkspaceFileSystemPort } from "../contracts";
import { DEFAULT_MAX_LIST_ENTRIES } from "../defaults";
import {
  PathContainmentError,
  resolveContainedPath,
} from "../internal/PathContainment";
import {
  listDirectoryInputSchema,
  listDirectoryOutputSchema,
} from "../internal/ToolCatalog";

export async function executeListDirectory(params: {
  arguments: unknown;
  grant: ToolGrant;
  workspaceRoot: string;
  fileSystem: WorkspaceFileSystemPort;
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
  const input = listDirectoryInputSchema.parse(params.arguments);
  const contained = await resolveContainedPath({
    fileSystem: params.fileSystem,
    workspaceRoot: params.workspaceRoot,
    requestedPath: input.path,
    pathScopes: params.grant.pathScopes,
  });

  const entries = await params.fileSystem.listDirectory(contained.realPath);
  const limited = entries.slice(0, DEFAULT_MAX_LIST_ENTRIES);
  const truncated = entries.length > limited.length;

  const output = listDirectoryOutputSchema.parse({
    path: contained.relativePath,
    entries: limited.map((entry) => ({
      name: entry.name,
      kind: entry.kind,
    })),
    truncated,
  });

  return { output, truncated, redacted: false };
}

export { PathContainmentError };
