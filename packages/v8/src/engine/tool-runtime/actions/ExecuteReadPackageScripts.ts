import type { ToolGrant } from "../../../modules/decision-policy";

import type { WorkspaceFileSystemPort } from "../contracts";
import { resolveContainedPath } from "../internal/PathContainment";
import { sanitizeTextOutput } from "../internal/OutputSanitizer";
import {
  readPackageScriptsInputSchema,
  readPackageScriptsOutputSchema,
} from "../internal/ToolCatalog";

/**
 * Read trusted package-manager scripts from a manifest (package.json today).
 * Helps Verification / agents avoid inventing script names.
 */
export async function executeReadPackageScripts(params: {
  arguments: unknown;
  grant: ToolGrant;
  workspaceRoot: string;
  fileSystem: WorkspaceFileSystemPort;
  maxOutputBytes: number;
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
  const input = readPackageScriptsInputSchema.parse(params.arguments);
  const contained = await resolveContainedPath({
    fileSystem: params.fileSystem,
    workspaceRoot: params.workspaceRoot,
    requestedPath: input.path,
    pathScopes: params.grant.pathScopes,
  });

  const read = await params.fileSystem.readFile(contained.realPath, {
    maxBytes: Math.min(64_000, params.maxOutputBytes),
  });

  let scripts: Record<string, string> = {};
  let packageManager: string | undefined;
  try {
    const parsed = JSON.parse(read.content) as {
      scripts?: Record<string, unknown>;
      packageManager?: unknown;
    };
    if (parsed.scripts && typeof parsed.scripts === "object") {
      for (const [name, value] of Object.entries(parsed.scripts)) {
        if (typeof value === "string") {
          scripts[name] = value;
        }
      }
    }
    if (typeof parsed.packageManager === "string") {
      packageManager = parsed.packageManager;
    }
  } catch {
    scripts = {};
  }

  const sanitizedEntries: Record<string, string> = {};
  let redacted = false;
  for (const [name, value] of Object.entries(scripts)) {
    const sanitized = sanitizeTextOutput(value, 2_000);
    redacted = redacted || sanitized.redacted;
    sanitizedEntries[name] = sanitized.text;
  }

  const output = readPackageScriptsOutputSchema.parse({
    path: contained.relativePath,
    scripts: sanitizedEntries,
    packageManager,
    truncated: read.truncated,
  });

  return { output, truncated: output.truncated, redacted };
}
