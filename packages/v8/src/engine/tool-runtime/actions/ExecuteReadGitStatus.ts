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
      const diffResult = await params.git.diff({
        workspaceRoot: params.workspaceRoot,
        paths: input.paths,
        signal: params.signal,
      });
      const sanitized = sanitizeTextOutput(
        diffResult.diff,
        params.maxOutputBytes,
      );
      diff = sanitized.text;
      truncated = diffResult.truncated || sanitized.truncated;
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
