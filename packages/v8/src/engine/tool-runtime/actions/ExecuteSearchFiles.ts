import type { ToolGrant } from "../../../modules/decision-policy";

import type { WorkspaceFileSystemPort } from "../contracts";
import {
  DEFAULT_MAX_SEARCH_FILE_BYTES,
  DEFAULT_MAX_SEARCH_MATCHES,
} from "../defaults";
import {
  resolveContainedPath,
  resolveScopedSearchPath,
} from "../internal/PathContainment";
import { sanitizeTextOutput } from "../internal/OutputSanitizer";
import { resolveSearchPattern } from "../internal/SearchPattern";
import {
  searchFilesInputSchema,
  searchFilesOutputSchema,
} from "../internal/ToolCatalog";

export async function executeSearchFiles(params: {
  arguments: unknown;
  grant: ToolGrant;
  workspaceRoot: string;
  fileSystem: WorkspaceFileSystemPort;
  maxOutputBytes: number;
}): Promise<{
  output: unknown;
  truncated: boolean;
  redacted: boolean;
  warnings?: string[];
}> {
  const input = searchFilesInputSchema.parse(params.arguments);
  const contained = await resolveContainedPath({
    fileSystem: params.fileSystem,
    workspaceRoot: params.workspaceRoot,
    requestedPath: resolveScopedSearchPath({
      requestedPath: input.path,
      pathScopes: params.grant.pathScopes,
    }),
    pathScopes: params.grant.pathScopes,
  });

  const maxMatches = input.maxMatches ?? DEFAULT_MAX_SEARCH_MATCHES;
  const files = await collectSearchFiles({
    fileSystem: params.fileSystem,
    contained,
    workspaceRoot: params.workspaceRoot,
  });

  const pattern = resolveSearchPattern({
    query: input.query,
    mode: input.mode,
    caseSensitive: input.caseSensitive,
  });
  const matches: Array<{ path: string; line: number; text: string }> = [];
  let truncated = false;
  let redacted = false;
  const warnings = pattern.warning ? [pattern.warning] : [];

  for (const file of files) {
    if (!isPathWithinGrant(file.relativePath, params.grant.pathScopes)) {
      continue;
    }
    const lines = file.content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      if (!pattern.matches(line)) {
        continue;
      }
      const sanitized = sanitizeTextOutput(line, 2_000);
      redacted = redacted || sanitized.redacted;
      matches.push({
        path: file.relativePath,
        line: i + 1,
        text: sanitized.text,
      });
      if (matches.length >= maxMatches) {
        truncated = true;
        break;
      }
    }
    if (truncated) {
      break;
    }
  }

  const output = searchFilesOutputSchema.parse({
    query: input.query,
    mode: pattern.mode,
    matches,
    truncated,
  });

  // Bound total payload size.
  const serialized = JSON.stringify(output);
  if (Buffer.byteLength(serialized, "utf8") > params.maxOutputBytes) {
    const reduced = {
      ...output,
      matches: output.matches.slice(0, Math.max(1, Math.floor(matches.length / 2))),
      truncated: true,
    };
    return {
      output: searchFilesOutputSchema.parse(reduced),
      truncated: true,
      redacted,
      warnings,
    };
  }

  return { output, truncated, redacted, warnings };
}

async function collectSearchFiles(params: {
  fileSystem: WorkspaceFileSystemPort;
  contained: { relativePath: string; realPath: string };
  workspaceRoot: string;
}): Promise<Array<{ relativePath: string; content: string }>> {
  const stat = await params.fileSystem.lstat(params.contained.realPath);
  if (stat.kind === "file") {
    return fallbackReadSingle(params.fileSystem, params.contained);
  }
  if (params.fileSystem.readTextFilesUnder) {
    return params.fileSystem.readTextFilesUnder(params.contained.realPath, {
      workspaceRoot: params.workspaceRoot,
      maxFiles: 500,
      maxFileBytes: DEFAULT_MAX_SEARCH_FILE_BYTES,
    });
  }
  return fallbackReadSingle(params.fileSystem, params.contained);
}

async function fallbackReadSingle(
  fileSystem: WorkspaceFileSystemPort,
  contained: { relativePath: string; realPath: string },
): Promise<Array<{ relativePath: string; content: string }>> {
  const stat = await fileSystem.lstat(contained.realPath);
  if (stat.kind !== "file") {
    return [];
  }
  const read = await fileSystem.readFile(contained.realPath, {
    maxBytes: DEFAULT_MAX_SEARCH_FILE_BYTES,
  });
  return [{ relativePath: contained.relativePath, content: read.content }];
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
