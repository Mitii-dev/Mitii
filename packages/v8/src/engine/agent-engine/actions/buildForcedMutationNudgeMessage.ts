import type { VerificationDiagnostic } from "../../../modules/verification";

import { buildPreflightDiagnosticRepairInstruction } from "./buildPreflightDiagnosticRepairInstruction";

/**
 * Hard user nudge when mutation discipline is active: stop reading and
 * apply_patch against preflight diagnostics (or stop with a blocker).
 */
export function buildForcedMutationNudgeMessage(params: {
  diagnostics?: readonly VerificationDiagnostic[];
  totalErrorCount?: number;
  pathScopes?: readonly string[];
  missingPath?: string;
  requestedTools?: readonly string[];
}): string {
  const lines: string[] = [
    "MUTATION REQUIRED NOW. Do not call list_directory, glob_files, search_files, or any further exploratory reads.",
    "Your next tool call MUST be apply_patch, delete_file, or move_file on a concrete path — or stop with a one-line Blocker.",
  ];

  const missing = params.missingPath?.trim();
  if (missing) {
    lines.push(
      `The path "${missing}" does not exist (or cannot be read). Create or fix it with apply_patch using the diagnostic list below; do not rediscover the tree.`,
    );
  }

  const tools = params.requestedTools?.filter(Boolean) ?? [];
  if (tools.length > 0) {
    lines.push(
      `Rejected this turn's read/search tools (${tools.join(", ")}). They are not allowed until a workspace edit lands.`,
    );
  }

  const diagnostics = buildPreflightDiagnosticRepairInstruction({
    diagnostics: params.diagnostics ?? [],
    totalErrorCount: params.totalErrorCount ?? params.diagnostics?.length ?? 0,
    pathScopes: params.pathScopes ?? ["."],
    maxDiagnostics: 16,
    maxChars: 3_600,
  });
  if (diagnostics) {
    lines.push(diagnostics);
  } else {
    lines.push(
      "If you already have file contents in context, call apply_patch immediately on the write target.",
    );
  }

  return lines.join("\n");
}
