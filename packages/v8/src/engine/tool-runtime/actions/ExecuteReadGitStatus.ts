import type { ToolGrant } from "../../../modules/decision-policy";

import type { GitPort } from "../contracts";
import { ToolRuntimeError } from "../contracts";
import { GitArgSafetyError } from "../internal/GitArgSafety";
import { sanitizeTextOutput } from "../internal/OutputSanitizer";
import {
  readGitStatusInputSchema,
  readGitStatusOutputSchema,
} from "../internal/ToolCatalog";
import { GrantValidationError } from "./ValidateGrant";

export async function executeReadGitStatus(params: {
  arguments: unknown;
  grant: ToolGrant;
  workspaceRoot: string;
  git?: GitPort;
  maxOutputBytes: number;
  signal?: AbortSignal;
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
  if (!params.git) {
    throw new ToolRuntimeError(
      "misconfigured_ports",
      "GitPort is required for read_git_status.",
    );
  }

  const input = readGitStatusInputSchema.parse(params.arguments);
  try {
    const status = await params.git.status({
      workspaceRoot: params.workspaceRoot,
      signal: params.signal,
    });

    let diff: string | undefined;
    let truncated = false;
    let redacted = false;

    if (input.includeDiff) {
      // A working-tree review needs both sides of `git status`: `git diff`
      // alone omits everything already staged in the index.
      const [stagedDiff, unstagedDiff] = await Promise.all([
        params.git.diff({
          workspaceRoot: params.workspaceRoot,
          paths: input.paths,
          staged: true,
          signal: params.signal,
        }),
        params.git.diff({
          workspaceRoot: params.workspaceRoot,
          paths: input.paths,
          signal: params.signal,
        }),
      ]);
      const combinedDiff = [
        stagedDiff.diff.trim()
          ? `# Staged changes\n${stagedDiff.diff}`
          : "",
        unstagedDiff.diff.trim()
          ? `# Unstaged changes\n${unstagedDiff.diff}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const sanitized = sanitizeTextOutput(
        combinedDiff,
        params.maxOutputBytes,
      );
      diff = sanitized.text;
      truncated =
        stagedDiff.truncated || unstagedDiff.truncated || sanitized.truncated;
      redacted = sanitized.redacted;
    }

    const output = readGitStatusOutputSchema.parse({
      branch: status.branch,
      staged: status.staged,
      unstaged: status.unstaged,
      untracked: status.untracked,
      diff,
      truncated,
    });

    return { output, truncated, redacted };
  } catch (error) {
    if (error instanceof GitArgSafetyError) {
      throw new GrantValidationError("invalid_arguments", error.message);
    }
    throw error;
  }
}
