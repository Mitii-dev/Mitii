import type { ToolGrant } from "../../decision-policy";

import type { WorkspaceFileSystemPort } from "../contracts";
import { DEFAULT_MAX_FILE_BYTES } from "../defaults";
import { resolveContainedPath } from "../internal/PathContainment";
import { sanitizeTextOutput } from "../internal/OutputSanitizer";
import {
  readFileInputSchema,
  readFileOutputSchema,
} from "../internal/ToolCatalog";

export async function executeReadFile(params: {
  arguments: unknown;
  grant: ToolGrant;
  workspaceRoot: string;
  fileSystem: WorkspaceFileSystemPort;
  maxOutputBytes: number;
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
  const input = readFileInputSchema.parse(params.arguments);
  const contained = await resolveContainedPath({
    fileSystem: params.fileSystem,
    workspaceRoot: params.workspaceRoot,
    requestedPath: input.path,
    pathScopes: params.grant.pathScopes,
  });

  const read = await params.fileSystem.readFile(contained.realPath, {
    maxBytes: Math.min(DEFAULT_MAX_FILE_BYTES, params.maxOutputBytes),
  });

  let content = read.content;
  let rangeTruncated = false;

  if (input.startLine !== undefined || input.endLine !== undefined) {
    const lines = content.split(/\r?\n/);
    const start = (input.startLine ?? 1) - 1;
    const end = input.endLine ?? lines.length;
    content = lines.slice(start, end).join("\n");
    rangeTruncated = end < lines.length || start > 0;
  }

  const sanitized = sanitizeTextOutput(content, params.maxOutputBytes);
  const output = readFileOutputSchema.parse({
    path: contained.relativePath,
    content: sanitized.text,
    startLine: input.startLine,
    endLine: input.endLine,
    truncated: read.truncated || sanitized.truncated || rangeTruncated,
  });

  return {
    output,
    truncated: output.truncated,
    redacted: sanitized.redacted,
  };
}
