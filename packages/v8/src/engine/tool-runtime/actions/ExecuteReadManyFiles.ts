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
  clipLineWindowToCharBudget,
  deriveMaxLinesFromCharBudget,
} from "../internal/readFileWindow";
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
  maxContentChars?: number;
}): Promise<{
  output: unknown;
  truncated: boolean;
  redacted: boolean;
  warnings?: string[];
}> {
  const input = readManyFilesInputSchema.parse(params.arguments);
  const maxBytesPerFile =
    input.maxBytesPerFile ?? DEFAULT_MAX_BYTES_PER_FILE_MANY;
  const maxContentChars =
    params.maxContentChars !== undefined
      ? Math.max(1, Math.floor(params.maxContentChars))
      : undefined;
  const maxLinesPerFile =
    input.maxLinesPerFile ??
    (maxContentChars !== undefined
      ? deriveMaxLinesFromCharBudget(
          Math.max(1, Math.floor(maxContentChars / Math.max(1, input.paths.length))),
        )
      : undefined);

  const files: Array<{
    path: string;
    content?: string;
    startLine?: number;
    endLine?: number;
    totalLines?: number;
    eof?: boolean;
    nextStartLine?: number;
    truncated: boolean;
    truncationReason?:
      | "byte_cap"
      | "line_range"
      | "max_lines"
      | "model_budget";
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
          truncationReason: "byte_cap",
          error: "output_budget_exhausted",
        });
        anyTruncated = true;
        continue;
      }
      const perFileContentBudget =
        maxContentChars !== undefined
          ? Math.max(
              1,
              Math.floor(maxContentChars / Math.max(1, input.paths.length)),
            )
          : undefined;
      const read = await params.fileSystem.readFile(contained.realPath, {
        maxBytes: Math.min(maxBytesPerFile, remainingBudget),
        maxLines: maxLinesPerFile,
      });
      let window: {
        content: string;
        startLine: number;
        endLine: number;
        totalLines?: number;
        eof: boolean;
        nextStartLine?: number;
        truncated: boolean;
        truncationReason?:
          | "byte_cap"
          | "line_range"
          | "max_lines"
          | "model_budget";
      } = {
        content: read.content,
        startLine: read.startLine,
        endLine: read.endLine,
        totalLines: read.totalLines,
        eof: read.eof,
        nextStartLine: read.nextStartLine,
        truncated: read.truncated,
        truncationReason: read.truncationReason,
      };
      if (perFileContentBudget !== undefined) {
        window = clipLineWindowToCharBudget(window, perFileContentBudget);
      }
      const sanitized = sanitizeTextOutput(window.content, remainingBudget);
      redacted = redacted || sanitized.redacted;
      usedBytes += Buffer.byteLength(sanitized.text, "utf8");
      const truncated = window.truncated || sanitized.truncated;
      anyTruncated = anyTruncated || truncated;
      files.push({
        path: contained.relativePath,
        content: sanitized.text,
        startLine: window.startLine,
        endLine: window.endLine,
        ...(window.totalLines !== undefined
          ? { totalLines: window.totalLines }
          : {}),
        eof: sanitized.truncated ? false : window.eof,
        ...(window.nextStartLine !== undefined || sanitized.truncated
          ? {
              nextStartLine:
                window.nextStartLine ??
                (window.endLine >= window.startLine
                  ? window.endLine + 1
                  : window.startLine),
            }
          : {}),
        truncated,
        ...(truncated
          ? {
              truncationReason:
                window.truncationReason ??
                (sanitized.truncated ? ("byte_cap" as const) : undefined),
            }
          : {}),
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

  const failedFiles = files.filter((file) => file.error);

  return {
    output,
    truncated: anyTruncated,
    redacted,
    warnings:
      failedFiles.length > 0
        ? [
            `${failedFiles.length} of ${files.length} requested file(s) could not be read: ${failedFiles
              .slice(0, 5)
              .map((file) => `${file.path} (${file.error})`)
              .join(", ")}${failedFiles.length > 5 ? ", ..." : ""}`,
          ]
        : undefined,
  };
}
