import type { GitPort } from "../contracts";
import { ToolRuntimeError } from "../contracts";
import { GitArgSafetyError } from "../internal/GitArgSafety";
import {
  readGitBranchesInputSchema,
  readGitBranchesOutputSchema,
  readGitLogInputSchema,
  readGitLogOutputSchema,
  readGitShowInputSchema,
  readGitShowOutputSchema,
} from "../internal/ToolCatalog";
import { GrantValidationError } from "./ValidateGrant";

function requireGitMethod<T extends keyof GitPort>(
  git: GitPort | undefined,
  method: T,
): NonNullable<GitPort[T]> {
  if (!git) {
    throw new ToolRuntimeError(
      "misconfigured_ports",
      `GitPort is required for ${String(method)}.`,
    );
  }
  const fn = git[method];
  if (typeof fn !== "function") {
    throw new GrantValidationError(
      "tool_unavailable",
      `GitPort does not implement ${String(method)}.`,
    );
  }
  return fn as NonNullable<GitPort[T]>;
}

function mapGitError(error: unknown): never {
  if (error instanceof GitArgSafetyError) {
    throw new GrantValidationError("invalid_arguments", error.message);
  }
  throw error;
}

export async function executeReadGitLog(params: {
  arguments: unknown;
  workspaceRoot: string;
  git?: GitPort;
  signal?: AbortSignal;
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
  const input = readGitLogInputSchema.parse(params.arguments);
  const log = requireGitMethod(params.git, "log");
  try {
    const result = await log.call(params.git, {
      workspaceRoot: params.workspaceRoot,
      maxCount: input.maxCount,
      paths: input.paths,
      signal: params.signal,
    });
    return {
      output: readGitLogOutputSchema.parse(result),
      truncated: result.truncated,
      redacted: false,
    };
  } catch (error) {
    mapGitError(error);
  }
}

export async function executeReadGitShow(params: {
  arguments: unknown;
  workspaceRoot: string;
  git?: GitPort;
  signal?: AbortSignal;
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
  const input = readGitShowInputSchema.parse(params.arguments);
  const show = requireGitMethod(params.git, "show");
  try {
    const result = await show.call(params.git, {
      workspaceRoot: params.workspaceRoot,
      revision: input.revision,
      path: input.path,
      signal: params.signal,
    });
    return {
      output: readGitShowOutputSchema.parse(result),
      truncated: result.truncated,
      redacted: false,
    };
  } catch (error) {
    mapGitError(error);
  }
}

export async function executeReadGitBranches(params: {
  arguments: unknown;
  workspaceRoot: string;
  git?: GitPort;
  signal?: AbortSignal;
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
  readGitBranchesInputSchema.parse(params.arguments ?? {});
  const listBranches = requireGitMethod(params.git, "listBranches");
  try {
    const result = await listBranches.call(params.git, {
      workspaceRoot: params.workspaceRoot,
      signal: params.signal,
    });
    return {
      output: readGitBranchesOutputSchema.parse(result),
      truncated: result.truncated,
      redacted: false,
    };
  } catch (error) {
    mapGitError(error);
  }
}
