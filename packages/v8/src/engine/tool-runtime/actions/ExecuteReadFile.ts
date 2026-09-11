import type { ToolGrant } from "../../../modules/decision-policy";

import type { WorkspaceFileSystemPort } from "../contracts";
import { DEFAULT_MAX_FILE_BYTES } from "../defaults";
import { resolveContainedPath } from "../internal/PathContainment";
import { sanitizeTextOutput } from "../internal/OutputSanitizer";
import {
  clipLineWindowToCharBudget,
  deriveMaxLinesFromCharBudget,
} from "../internal/readFileWindow";
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
  /** Optional model-facing content budget (line-windowed). */
  maxContentChars?: number;
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
  const input = readFileInputSchema.parse(params.arguments);
  const contained = await resolveContainedPath({
    fileSystem: params.fileSystem,
    workspaceRoot: params.workspaceRoot,
    requestedPath: input.path,
    pathScopes: params.grant.pathScopes,
  });

  const maxBytes = Math.min(DEFAULT_MAX_FILE_BYTES, params.maxOutputBytes);
  const maxContentChars =
    params.maxContentChars !== undefined
      ? Math.max(1, Math.floor(params.maxContentChars))
      : undefined;

  const head = input.head;
  const tail = input.tail;
  const startLine = head !== undefined ? 1 : input.startLine;
  const endLine = head !== undefined ? undefined : input.endLine;
  const maxLines =
    head !== undefined
      ? head
      : (input.maxLines ??
        (maxContentChars !== undefined && tail === undefined
          ? deriveMaxLinesFromCharBudget(maxContentChars)
          : undefined));

  const read = await params.fileSystem.readFile(contained.realPath, {
    maxBytes,
    startLine,
    endLine,
    maxLines,
    ...(tail !== undefined ? { tailLines: tail } : {}),
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

  if (maxContentChars !== undefined) {
    window = clipLineWindowToCharBudget(window, maxContentChars);
  }

  const sanitized = sanitizeTextOutput(window.content, params.maxOutputBytes);
  if (sanitized.truncated) {
    window = {
      ...window,
      content: sanitized.text,
      truncated: true,
      truncationReason: window.truncationReason ?? "byte_cap",
      eof: false,
      nextStartLine:
        window.nextStartLine ??
        (window.endLine >= window.startLine
          ? window.endLine + 1
          : Math.max(1, window.startLine)),
    };
  } else {
    window = { ...window, content: sanitized.text };
  }

  const output = readFileOutputSchema.parse({
    path: contained.relativePath,
    content: window.content,
    startLine: Math.max(1, window.startLine || 1),
    endLine: Math.max(0, window.endLine),
    ...(window.totalLines !== undefined
      ? { totalLines: window.totalLines }
      : {}),
    eof: window.eof,
    ...(window.nextStartLine !== undefined
      ? { nextStartLine: window.nextStartLine }
      : {}),
    truncated: window.truncated,
    ...(window.truncationReason
      ? { truncationReason: window.truncationReason }
      : {}),
  });

  return {
    output,
    truncated: window.truncated,
    redacted: sanitized.redacted,
  };
}
