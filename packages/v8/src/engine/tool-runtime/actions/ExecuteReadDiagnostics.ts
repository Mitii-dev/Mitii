import type { ToolGrant } from "../../../modules/decision-policy";

import type { DiagnosticsPort, WorkspaceFileSystemPort } from "../contracts";
import { ToolRuntimeError } from "../contracts";
import {
  DEFAULT_DIAGNOSTICS_SETTLE_POLL_MS,
  DEFAULT_DIAGNOSTICS_SETTLE_STABLE_READS,
  DEFAULT_DIAGNOSTICS_SETTLE_TIMEOUT_MS,
} from "../defaults";
import {
  PathContainmentError,
  resolveContainedPath,
} from "../internal/PathContainment";
import {
  readDiagnosticsInputSchema,
  readDiagnosticsOutputSchema,
} from "../internal/ToolCatalog";
import { settleDiagnosticsPort } from "./collectPostEditDiagnostics";

export async function executeReadDiagnostics(params: {
  arguments: unknown;
  grant: ToolGrant;
  workspaceRoot: string;
  fileSystem: WorkspaceFileSystemPort;
  diagnostics?: DiagnosticsPort;
  signal?: AbortSignal;
}): Promise<{
  output: unknown;
  truncated: boolean;
  redacted: boolean;
  warnings?: string[];
}> {
  if (!params.diagnostics) {
    throw new ToolRuntimeError(
      "misconfigured_ports",
      "DiagnosticsPort is required for read_diagnostics.",
    );
  }

  const input = readDiagnosticsInputSchema.parse(params.arguments);
  const scopedPaths: string[] = [];
  const deniedPaths: string[] = [];

  if (input.paths) {
    for (const requested of input.paths) {
      try {
        const contained = await resolveContainedPath({
          fileSystem: params.fileSystem,
          workspaceRoot: params.workspaceRoot,
          requestedPath: requested,
          pathScopes: params.grant.pathScopes,
        });
        scopedPaths.push(contained.relativePath);
      } catch (error) {
        if (error instanceof PathContainmentError) {
          deniedPaths.push(requested);
          continue;
        }
        throw error;
      }
    }
  }

  const deniedWarnings =
    deniedPaths.length > 0
      ? [
          `${deniedPaths.length} of ${input.paths?.length ?? 0} requested path(s) were outside the granted scope and skipped: ${deniedPaths.slice(0, 5).join(", ")}${deniedPaths.length > 5 ? ", ..." : ""}`,
        ]
      : [];

  if (input.paths && scopedPaths.length === 0) {
    const output = readDiagnosticsOutputSchema.parse({ diagnostics: [] });
    return {
      output,
      truncated: false,
      redacted: false,
      warnings: deniedWarnings,
    };
  }

  // IDE hosts need a settle window so LSP updates land before we snapshot.
  // Synchronous adapters no-op quickly via settleDiagnosticsPort.
  try {
    await settleDiagnosticsPort(params.diagnostics, {
      workspaceRoot: params.workspaceRoot,
      paths: input.paths ? scopedPaths : undefined,
      timeoutMs: DEFAULT_DIAGNOSTICS_SETTLE_TIMEOUT_MS,
      pollIntervalMs: DEFAULT_DIAGNOSTICS_SETTLE_POLL_MS,
      stableReads: DEFAULT_DIAGNOSTICS_SETTLE_STABLE_READS,
      signal: params.signal,
    });
  } catch {
    // Settle failures must not block the read — stale is better than empty.
  }

  const diagnostics = await params.diagnostics.readDiagnostics({
    workspaceRoot: params.workspaceRoot,
    paths: input.paths ? scopedPaths : undefined,
  });

  const filtered = diagnostics.filter((item) => {
    if (isMitiiRuntimeNoisePath(item.path)) {
      return false;
    }
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

  return { output, truncated: false, redacted: false, warnings: deniedWarnings };
}

/** Host logs / Mitii workspace artifacts are not actionable code diagnostics. */
function isMitiiRuntimeNoisePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  return (
    normalized === ".mitii" ||
    normalized.startsWith(".mitii/") ||
    /(^|\/)\.mitii\/logs\//.test(normalized) ||
    normalized.endsWith("-model-io.jsonl")
  );
}
