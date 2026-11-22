import type { ToolGrant } from "../../../modules/decision-policy";

import type {
  WorkspaceFileSystemPort,
  WorkspaceTextSearchPort,
} from "../contracts";
import { FileSystemWorkspaceTextSearchAdapter } from "../adapters/FileSystemWorkspaceTextSearchAdapter";
import { DEFAULT_MAX_SEARCH_MATCHES } from "../defaults";
import {
  resolveContainedPath,
  resolveScopedSearchPath,
} from "../internal/PathContainment";
import { resolveSearchPattern } from "../internal/SearchPattern";
import {
  searchFilesInputSchema,
  searchFilesOutputSchema,
} from "../internal/ToolCatalog";
import { sanitizeTextOutput } from "../internal/OutputSanitizer";

export async function executeSearchFiles(params: {
  arguments: unknown;
  grant: ToolGrant;
  workspaceRoot: string;
  fileSystem: WorkspaceFileSystemPort;
  workspaceTextSearch?: WorkspaceTextSearchPort;
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
    extraAllowedRoots: params.grant.extraAllowedRoots,
  });

  const maxMatches = input.maxMatches ?? DEFAULT_MAX_SEARCH_MATCHES;
  const pattern = resolveSearchPattern({
    query: input.query,
    mode: input.mode,
    caseSensitive: input.caseSensitive,
  });
  const warnings = pattern.warning ? [pattern.warning] : [];

  const searcher =
    params.workspaceTextSearch ??
    new FileSystemWorkspaceTextSearchAdapter(params.fileSystem);

  const result = await searcher.search({
    workspaceRoot: params.workspaceRoot,
    searchRoot: contained.realPath,
    searchRootRelative: contained.relativePath,
    query: input.query,
    mode: pattern.mode,
    caseSensitive: input.caseSensitive === true,
    maxMatches,
    pathScopes: params.grant.pathScopes,
  });

  if (result.warning) warnings.push(result.warning);

  let redacted = false;
  const matches = result.matches.map((match) => {
    const sanitized = sanitizeTextOutput(match.text, 2_000);
    redacted = redacted || sanitized.redacted;
    return {
      path: match.path,
      line: match.line,
      text: sanitized.text,
    };
  });

  const truncated = result.truncated;
  const output = searchFilesOutputSchema.parse({
    query: input.query,
    mode: pattern.mode,
    matches,
    truncated,
  });

  const serialized = JSON.stringify(output);
  if (Buffer.byteLength(serialized, "utf8") > params.maxOutputBytes) {
    const reduced = {
      ...output,
      matches: output.matches.slice(
        0,
        Math.max(1, Math.floor(matches.length / 2)),
      ),
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
