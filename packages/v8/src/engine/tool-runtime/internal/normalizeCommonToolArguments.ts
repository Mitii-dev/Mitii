/**
 * Normalize common model mis-encodings before Zod validation.
 * Restrict-only: aliases map onto the real schema; never invents tools/grants.
 */
import {
  normalizeGlobFilesArguments,
  normalizeReadDiagnosticsArguments,
  normalizeReadFileArguments,
  normalizeReadGitLogArguments,
  normalizeReadGitShowArguments,
  normalizeSearchFilesArguments,
} from "./normalize/discovery";
import {
  normalizeAnalyzeChangeImpactArguments,
  normalizeArgvCommandArguments,
  normalizeEmitReviewFindingArguments,
} from "./normalize/processMeta";
import { normalizeCiWorkflowPath } from "./canonicalizeMutationPath";

export function normalizeCommonToolArguments(
  toolName: string,
  value: unknown,
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  // Phase 6: mutation path tools get github/ → .github/ rewrite.
  if (
    toolName === "delete_file" ||
    toolName === "delete_directory" ||
    toolName === "move_file"
  ) {
    return normalizeMutationPathToolArguments(
      toolName,
      value as Record<string, unknown>,
    );
  }

  if (toolName === "search_files") {
    return normalizeSearchFilesArguments(value as Record<string, unknown>);
  }

  if (toolName === "run_readonly_command" || toolName === "run_command") {
    return normalizeArgvCommandArguments(value as Record<string, unknown>);
  }

  if (toolName === "glob_files") {
    return normalizeGlobFilesArguments(value as Record<string, unknown>);
  }

  if (toolName === "emit_review_finding") {
    return normalizeEmitReviewFindingArguments(value as Record<string, unknown>);
  }

  if (toolName === "read_git_show") {
    return normalizeReadGitShowArguments(value as Record<string, unknown>);
  }

  if (toolName === "read_git_log") {
    return normalizeReadGitLogArguments(value as Record<string, unknown>);
  }

  if (toolName === "read_diagnostics") {
    return normalizeReadDiagnosticsArguments(value as Record<string, unknown>);
  }

  if (toolName === "read_file" || toolName === "read_many_files") {
    return normalizeReadFileArguments(value as Record<string, unknown>);
  }

  if (toolName === "analyze_change_impact") {
    return normalizeAnalyzeChangeImpactArguments(
      value as Record<string, unknown>,
    );
  }

  return value;
}

function normalizeMutationPathToolArguments(
  toolName: string,
  value: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...value };
  if (typeof next.path === "string") {
    next.path = normalizeCiWorkflowPath(next.path);
  }
  if (toolName === "move_file") {
    if (typeof next.from === "string") {
      next.from = normalizeCiWorkflowPath(next.from);
    }
    if (typeof next.to === "string") {
      next.to = normalizeCiWorkflowPath(next.to);
    }
  }
  return next;
}
