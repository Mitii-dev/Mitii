import type { ToolGrant } from "../../../modules/decision-policy";

import type { AstGrepPort, WorkspaceFileSystemPort } from "../contracts";
import { DEFAULT_MAX_SEARCH_MATCHES } from "../defaults";
import {
  resolveContainedPath,
  resolveScopedSearchPath,
} from "../internal/PathContainment";
import {
  structuralSearchInputSchema,
  structuralSearchOutputSchema,
} from "../internal/ToolCatalog";

export async function executeStructuralSearch(params: {
  arguments: unknown;
  grant: ToolGrant;
  workspaceRoot: string;
  fileSystem: WorkspaceFileSystemPort;
  astGrep?: AstGrepPort;
  maxOutputBytes: number;
}): Promise<{
  output: unknown;
  truncated: boolean;
  redacted: boolean;
  warnings?: string[];
}> {
  const input = structuralSearchInputSchema.parse(params.arguments);
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

  const warnings: string[] = [];
  if (!params.astGrep) {
    const output = structuralSearchOutputSchema.parse({
      pattern: input.pattern,
      matches: [],
      truncated: false,
      backend: "unavailable",
    });
    return {
      output,
      truncated: false,
      redacted: false,
      warnings: [
        "structural_search requires ast-grep on the host PATH (AstGrepPort).",
      ],
    };
  }

  const result = await params.astGrep.search({
    workspaceRoot: params.workspaceRoot,
    searchRoot: contained.realPath,
    pattern: input.pattern,
    ...(input.language ? { language: input.language } : {}),
    maxMatches: input.maxMatches ?? DEFAULT_MAX_SEARCH_MATCHES,
  });

  if (result.warning) warnings.push(result.warning);
  if (!result.available) {
    warnings.push(
      "ast-grep unavailable; install `@ast-grep/cli` or ensure `sg` is on PATH.",
    );
  }

  const output = structuralSearchOutputSchema.parse({
    pattern: input.pattern,
    matches: result.matches,
    truncated: result.truncated,
    backend: result.available ? "ast_grep" : "unavailable",
  });

  return {
    output,
    truncated: result.truncated,
    redacted: false,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
