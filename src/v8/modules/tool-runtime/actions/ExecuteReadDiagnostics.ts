import type { ToolGrant } from "../../decision-policy";

import type { DiagnosticsPort, WorkspaceFileSystemPort } from "../contracts";
import { ToolRuntimeError } from "../contracts";
import { resolveContainedPath } from "../internal/PathContainment";
import {
  readDiagnosticsInputSchema,
  readDiagnosticsOutputSchema,
} from "../internal/ToolCatalog";

export async function executeReadDiagnostics(params: {
  arguments: unknown;
  grant: ToolGrant;
  workspaceRoot: string;
  fileSystem: WorkspaceFileSystemPort;
  diagnostics?: DiagnosticsPort;
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
  if (!params.diagnostics) {
    throw new ToolRuntimeError(
      "misconfigured_ports",
      "DiagnosticsPort is required for read_diagnostics.",
    );
  }

  const input = readDiagnosticsInputSchema.parse(params.arguments);
  const scopedPaths: string[] = [];

  if (input.paths) {
    for (const requested of input.paths) {
      const contained = await resolveContainedPath({
        fileSystem: params.fileSystem,
        workspaceRoot: params.workspaceRoot,
        requestedPath: requested,
        pathScopes: params.grant.pathScopes,
      });
      scopedPaths.push(contained.relativePath);
    }
  }

  const diagnostics = await params.diagnostics.readDiagnostics({
    workspaceRoot: params.workspaceRoot,
    paths: scopedPaths.length > 0 ? scopedPaths : undefined,
  });

  const filtered = diagnostics.filter((item) => {
    if (params.grant.pathScopes.includes(".")) {
      return true;
    }
    return params.grant.pathScopes.some(
      (scope) => item.path === scope || item.path.startsWith(`${scope}/`),
    );
  });

  const output = readDiagnosticsOutputSchema.parse({
    diagnostics: filtered,
  });

  return { output, truncated: false, redacted: false };
}
