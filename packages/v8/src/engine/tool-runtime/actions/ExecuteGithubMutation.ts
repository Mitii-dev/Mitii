/**
 * Native GitHub issue / PR tools (Phase 2).
 * Execute via `gh` argv — no shell. Decision Policy must grant the tool id.
 */
import type { ProcessPort } from "../contracts";
import type { ToolGrant } from "../../../modules/decision-policy";
import {
  createGithubIssueInputSchema,
  createPullRequestInputSchema,
  githubMutationOutputSchema,
} from "../internal/ToolCatalog";
import { sanitizeTextOutput } from "../internal/OutputSanitizer";
import { GrantValidationError } from "./ValidateGrant";

function assertGithubToolGrant(params: {
  grant: ToolGrant;
  toolName: string;
}): void {
  if (!params.grant.allowedTools.includes(params.toolName)) {
    throw new GrantValidationError(
      "tool_not_allowed",
      `Tool "${params.toolName}" is not in grant.allowedTools.`,
    );
  }
  if (params.grant.maximumWorkspaceEffect !== "write") {
    throw new GrantValidationError(
      "effect_not_granted",
      `Tool "${params.toolName}" requires write workspace effect.`,
    );
  }
  if (!params.grant.allowedEffects.includes("process_execute")) {
    throw new GrantValidationError(
      "effect_not_granted",
      `Tool "${params.toolName}" requires effect "process_execute".`,
    );
  }
}

function extractUrl(stdout: string): string | undefined {
  const match = /https:\/\/github\.com\/[^\s]+/.exec(stdout);
  return match?.[0];
}

export async function executeCreateGithubIssue(params: {
  arguments: unknown;
  grant: ToolGrant;
  workspaceRoot: string;
  process: ProcessPort;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}): Promise<{
  output: unknown;
  truncated: boolean;
  redacted: boolean;
  timedOut: boolean;
  cancelled: boolean;
}> {
  assertGithubToolGrant({
    grant: params.grant,
    toolName: "create_github_issue",
  });
  const input = createGithubIssueInputSchema.parse(params.arguments);
  const argv = [
    "gh",
    "issue",
    "create",
    "--title",
    input.title,
    "--body",
    input.body,
  ];
  for (const label of input.labels ?? []) {
    argv.push("--label", label);
  }
  for (const assignee of input.assignees ?? []) {
    argv.push("--assignee", assignee);
  }

  const result = await params.process.execFile({
    argv,
    cwd: params.workspaceRoot,
    timeoutMs: params.timeoutMs,
    maxOutputBytes: params.maxOutputBytes,
    signal: params.signal,
  });
  const stdout = sanitizeTextOutput(result.stdout, params.maxOutputBytes);
  const stderr = sanitizeTextOutput(
    result.stderr,
    Math.max(1_024, Math.floor(params.maxOutputBytes / 4)),
  );
  const output = githubMutationOutputSchema.parse({
    argv,
    exitCode: result.exitCode,
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: result.truncated || stdout.truncated || stderr.truncated,
    url: extractUrl(stdout.text),
  });
  return {
    output,
    truncated: output.truncated,
    redacted: stdout.redacted || stderr.redacted,
    timedOut: result.timedOut,
    cancelled: result.cancelled,
  };
}

export async function executeCreatePullRequest(params: {
  arguments: unknown;
  grant: ToolGrant;
  workspaceRoot: string;
  process: ProcessPort;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}): Promise<{
  output: unknown;
  truncated: boolean;
  redacted: boolean;
  timedOut: boolean;
  cancelled: boolean;
}> {
  assertGithubToolGrant({
    grant: params.grant,
    toolName: "create_pull_request",
  });
  const input = createPullRequestInputSchema.parse(params.arguments);
  if (input.head === input.base) {
    throw new GrantValidationError(
      "invalid_arguments",
      "create_pull_request: head and base must differ.",
    );
  }
  if (
    input.head === "main" ||
    input.head === "master" ||
    input.head.endsWith("/main") ||
    input.head.endsWith("/master")
  ) {
    throw new GrantValidationError(
      "invalid_arguments",
      "create_pull_request: refusing to open a PR with head branch main/master.",
    );
  }

  const argv = [
    "gh",
    "pr",
    "create",
    "--title",
    input.title,
    "--body",
    input.body,
    "--head",
    input.head,
    "--base",
    input.base,
  ];
  if (input.draft !== false) {
    argv.push("--draft");
  }

  const result = await params.process.execFile({
    argv,
    cwd: params.workspaceRoot,
    timeoutMs: params.timeoutMs,
    maxOutputBytes: params.maxOutputBytes,
    signal: params.signal,
  });
  const stdout = sanitizeTextOutput(result.stdout, params.maxOutputBytes);
  const stderr = sanitizeTextOutput(
    result.stderr,
    Math.max(1_024, Math.floor(params.maxOutputBytes / 4)),
  );
  const output = githubMutationOutputSchema.parse({
    argv,
    exitCode: result.exitCode,
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: result.truncated || stdout.truncated || stderr.truncated,
    url: extractUrl(stdout.text),
  });
  return {
    output,
    truncated: output.truncated,
    redacted: stdout.redacted || stderr.redacted,
    timedOut: result.timedOut,
    cancelled: result.cancelled,
  };
}
