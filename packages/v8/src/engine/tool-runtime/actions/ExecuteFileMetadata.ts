import { createHash } from "node:crypto";

import type { ToolGrant } from "../../../modules/decision-policy";

import type { WorkspaceFileSystemPort } from "../contracts";
import { DEFAULT_MAX_FILE_METADATA_HASH_BYTES } from "../defaults";
import { resolveContainedPath } from "../internal/PathContainment";
import {
  fileMetadataInputSchema,
  fileMetadataOutputSchema,
} from "../internal/ToolCatalog";

export async function executeFileMetadata(params: {
  arguments: unknown;
  grant: ToolGrant;
  workspaceRoot: string;
  fileSystem: WorkspaceFileSystemPort;
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
  const input = fileMetadataInputSchema.parse(params.arguments);
  const contained = await resolveContainedPath({
    fileSystem: params.fileSystem,
    workspaceRoot: params.workspaceRoot,
    requestedPath: input.path,
    pathScopes: params.grant.pathScopes,
  });

  const stat = await params.fileSystem.lstat(contained.absolutePath);
  const includeHash = input.includeHash !== false && stat.kind === "file";

  let hash:
    | { algorithm: "sha256"; hex: string; truncated: boolean }
    | undefined;

  if (includeHash) {
    const read = await params.fileSystem.readFile(contained.realPath, {
      maxBytes: DEFAULT_MAX_FILE_METADATA_HASH_BYTES,
    });
    hash = {
      algorithm: "sha256",
      hex: createHash("sha256").update(read.content, "utf8").digest("hex"),
      truncated: read.truncated,
    };
  }

  const output = fileMetadataOutputSchema.parse({
    path: contained.relativePath,
    kind: stat.kind,
    sizeBytes: stat.sizeBytes,
    mtimeMs: stat.mtimeMs,
    isSymlink: stat.isSymlink,
    hash,
  });

  return { output, truncated: hash?.truncated ?? false, redacted: false };
}
