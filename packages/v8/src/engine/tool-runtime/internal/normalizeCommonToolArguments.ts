/**
 * Normalize common model mis-encodings before Zod validation.
 * Restrict-only: aliases map onto the real schema; never invents tools/grants.
 */
import {
  normalizeGlobFilesArguments,
  normalizeReadDiagnosticsArguments,
  normalizeReadFileArguments,
  normalizeReadGitShowArguments,
  normalizeSearchFilesArguments,
} from "./normalize/discovery";
import {
  normalizeAnalyzeChangeImpactArguments,
  normalizeArgvCommandArguments,
  normalizeEmitReviewFindingArguments,
} from "./normalize/processMeta";

export function normalizeCommonToolArguments(
  toolName: string,
  value: unknown,
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
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
