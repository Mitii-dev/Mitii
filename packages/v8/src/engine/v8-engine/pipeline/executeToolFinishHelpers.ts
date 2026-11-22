import {
  markLoopFileReadResult,
} from "../actions";
import type { LoopFileReadTracker } from "../actions";
import { WORKSPACE_FILE_MUTATION_TOOL_IDS } from "../actions/resolveLoopTurnOutcome";

/** File edits only — not run_command (git diff was wrongly change-impact gated). */
export function isChangeImpactGatedToolName(name: string): boolean {
  return (WORKSPACE_FILE_MUTATION_TOOL_IDS as readonly string[]).includes(name);
}

/** Mark base-path coverage from read_file / read_many_files outputs. */
export function markReadCoverageFromToolResult(
  tracker: LoopFileReadTracker,
  toolName: string,
  output: unknown,
  topLevelTruncated: boolean,
): void {
  if (!output || typeof output !== "object") {
    return;
  }
  const record = output as Record<string, unknown>;
  if (toolName === "read_file" && typeof record.path === "string") {
    markLoopFileReadResult(tracker, record.path, {
      truncated:
        topLevelTruncated ||
        record.truncated === true ||
        record.eof === false,
      eof: record.eof === true,
    });
    return;
  }
  if (toolName === "read_many_files" && Array.isArray(record.files)) {
    for (const file of record.files) {
      if (!file || typeof file !== "object") continue;
      const entry = file as Record<string, unknown>;
      if (typeof entry.path !== "string") continue;
      markLoopFileReadResult(tracker, entry.path, {
        truncated:
          topLevelTruncated ||
          entry.truncated === true ||
          entry.eof === false,
        eof: entry.eof === true,
      });
    }
  }
}
