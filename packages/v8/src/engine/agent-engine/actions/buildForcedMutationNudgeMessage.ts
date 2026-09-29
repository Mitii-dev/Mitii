import type { VerificationDiagnostic } from "../../../modules/verification";

import { buildPreflightDiagnosticRepairInstruction } from "./buildPreflightDiagnosticRepairInstruction";
import { preflightDiagnosticsForUserRequest } from "./shouldForcePreflightRepairLock";

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
  /** When set, preflight errors the request never names are omitted. */
  userPrompt?: string;
}): string {
  const relatedDiagnostics = preflightDiagnosticsForUserRequest(
    params.diagnostics ?? [],
    params.userPrompt,
  );
  const droppedUnrelatedPreflight =
    (params.diagnostics?.length ?? 0) > 0 && relatedDiagnostics.length === 0;
  const lines: string[] = droppedUnrelatedPreflight
    ? [
        "The preflight build errors are not the files named in the user request. Do not patch them and do not stop with a blocker about them.",
        "Call read_file on a path the request already names if its contents are not in context, then apply_patch the implementation those failures point at.",
        "Do not call list_directory, glob_files, or search_files.",
      ]
    : [
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
  if (tools.length > 0 && !droppedUnrelatedPreflight) {
    lines.push(
      `Rejected this turn's read/search tools (${tools.join(", ")}). They are not allowed until a workspace edit lands.`,
    );
  } else if (tools.length > 0) {
    lines.push(
      `Rejected this turn's broad discovery (${tools.join(", ")}). Targeted read_file of a path named in the request is still allowed, then apply_patch.`,
    );
  }

  const diagnostics = buildPreflightDiagnosticRepairInstruction({
    diagnostics: relatedDiagnostics,
    totalErrorCount:
      relatedDiagnostics.length === (params.diagnostics?.length ?? 0)
        ? (params.totalErrorCount ?? relatedDiagnostics.length)
        : relatedDiagnostics.length,
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
