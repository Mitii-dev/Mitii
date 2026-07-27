import type { ToolGrant } from "../../../modules/decision-policy";

import type { WorkspaceFileSystemPort } from "../contracts";
import {
  DEFAULT_MAX_BYTES_PER_FILE_MANY,
} from "../defaults";
import {
  PathContainmentError,
  resolveContainedPath,
} from "../internal/PathContainment";
import { sanitizeTextOutput } from "../internal/OutputSanitizer";
import {
  readManyFilesInputSchema,
  readManyFilesOutputSchema,
} from "../internal/ToolCatalog";

export async function executeReadManyFiles(params: {
  arguments: unknown;
  grant: ToolGrant;
  workspaceRoot: string;
  fileSystem: WorkspaceFileSystemPort;
  maxOutputBytes: number;
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
  const input = readManyFilesInputSchema.parse(params.arguments);
  const maxBytesPerFile =
    input.maxBytesPerFile ?? DEFAULT_MAX_BYTES_PER_FILE_MANY;

  const files: Array<{
    path: string;
    content?: string;
    truncated: boolean;
    error?: string;
  }> = [];
  let anyTruncated = false;
  let redacted = false;
  let usedBytes = 0;

  for (const requestedPath of input.paths) {
    try {
      const contained = await resolveContainedPath({
        fileSystem: params.fileSystem,
        workspaceRoot: params.workspaceRoot,
        requestedPath,
        pathScopes: params.grant.pathScopes,
      });
      const remainingBudget = Math.max(0, params.maxOutputBytes - usedBytes);
      if (remainingBudget === 0) {
        files.push({
          path: contained.relativePath,
          truncated: true,
          error: "output_budget_exhausted",
        });
        anyTruncated = true;
        continue;
      }
      const read = await params.fileSystem.readFile(contained.realPath, {
        maxBytes: Math.min(maxBytesPerFile, remainingBudget),
      });
      const sanitized = sanitizeTextOutput(read.content, remainingBudget);
      redacted = redacted || sanitized.redacted;
      usedBytes += Buffer.byteLength(sanitized.text, "utf8");
      const truncated = read.truncated || sanitized.truncated;
      anyTruncated = anyTruncated || truncated;
      files.push({
        path: contained.relativePath,
        content: sanitized.text,
        truncated,
      });
    } catch (error) {
      const message =
        error instanceof PathContainmentError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Failed to read file.";
      files.push({
        path: requestedPath,
        truncated: false,
        error: message,
      });
    }
  }

  const output = readManyFilesOutputSchema.parse({
    files,
    truncated: anyTruncated,
  });

  return {
    output,
    truncated: anyTruncated,
    redacted,
  };
}
