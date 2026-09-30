/**
 * Add Signed-off-by trailers across a commit range (DCO fix).
 * Argv-only via ProcessPort — no shell. Protected branches refused.
 */
import type { ProcessPort } from "../contracts";
import type { ToolGrant } from "../../../modules/decision-policy";
import {
  gitSignoffRangeInputSchema,
  gitSignoffRangeOutputSchema,
} from "../internal/ToolCatalog";
import { assertSafeGitArg } from "../internal/GitArgSafety";
import { sanitizeTextOutput } from "../internal/OutputSanitizer";
import { GrantValidationError } from "./ValidateGrant";
import { isProtectedBranch } from "./ExecuteGithubMutation";

const SIGNOFF_EXEC = "git commit --amend --no-edit --signoff";
const STASH_MESSAGE = "mitii-dco-signoff";

function assertGitSignoffGrant(grant: ToolGrant): void {
  if (!grant.allowedTools.includes("git_signoff_range")) {
    throw new GrantValidationError(
      "tool_not_allowed",
      'Tool "git_signoff_range" is not in grant.allowedTools.',
    );
  }
  if (grant.maximumWorkspaceEffect !== "write") {
    throw new GrantValidationError(
      "effect_not_granted",
      'Tool "git_signoff_range" requires write workspace effect.',
    );
  }
  if (!grant.allowedEffects.includes("process_execute")) {
    throw new GrantValidationError(
      "effect_not_granted",
      'Tool "git_signoff_range" requires effect "process_execute".',
    );
  }
  if (!grant.allowedEffects.includes("git_write")) {
    throw new GrantValidationError(
      "effect_not_granted",
      'Tool "git_signoff_range" requires effect "git_write".',
    );
  }
}

async function execGit(params: {
  process: ProcessPort;
  workspaceRoot: string;
  argv: string[];
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
  cancelled: boolean;
  redacted: boolean;
}> {
  const result = await params.process.execFile({
    argv: params.argv,
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
  return {
    exitCode: result.exitCode,
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: result.truncated || stdout.truncated || stderr.truncated,
    timedOut: result.timedOut,
    cancelled: result.cancelled,
    redacted: stdout.redacted || stderr.redacted,
  };
}

export async function executeGitSignoffRange(params: {
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
  assertGitSignoffGrant(params.grant);
  const input = gitSignoffRangeInputSchema.parse(params.arguments);
  assertSafeGitArg(input.base, "base");
  const remote = input.remote ?? "origin";
  assertSafeGitArg(remote, "remote");

  const branchResult = await execGit({
    ...params,
    argv: ["git", "rev-parse", "--abbrev-ref", "HEAD"],
  });
  if (branchResult.exitCode !== 0) {
    throw new GrantValidationError(
      "execution_failed",
      `git_signoff_range: could not resolve HEAD branch (${branchResult.stderr.trim() || "rev-parse failed"}).`,
    );
  }
  const branch = branchResult.stdout.trim();
  if (!branch || branch === "HEAD") {
    throw new GrantValidationError(
      "command_not_allowed",
      "git_signoff_range: refusing detached HEAD; check out a feature branch first.",
    );
  }
  if (isProtectedBranch(branch)) {
    throw new GrantValidationError(
      "command_not_allowed",
      `git_signoff_range: refusing to rewrite protected branch "${branch}".`,
    );
  }

  let stashed = false;
  const status = await execGit({
    ...params,
    argv: ["git", "status", "--porcelain"],
  });
  if (status.exitCode === 0 && status.stdout.trim().length > 0) {
    const stash = await execGit({
      ...params,
      argv: ["git", "stash", "push", "-u", "-m", STASH_MESSAGE],
    });
    if (stash.exitCode !== 0) {
      throw new GrantValidationError(
        "execution_failed",
        `git_signoff_range: stash failed (${stash.stderr.trim() || "stash failed"}).`,
      );
    }
    stashed = true;
  }

  const rebaseArgv = [
    "git",
    "rebase",
    "--exec",
    SIGNOFF_EXEC,
    input.base,
  ];
  const rebase = await execGit({
    ...params,
    argv: rebaseArgv,
  });

  if (rebase.exitCode !== 0) {
    await execGit({
      ...params,
      argv: ["git", "rebase", "--abort"],
    }).catch(() => undefined);
    if (stashed) {
      await execGit({
        ...params,
        argv: ["git", "stash", "pop"],
      }).catch(() => undefined);
    }
    throw new GrantValidationError(
      "execution_failed",
      `git_signoff_range: rebase failed (${rebase.stderr.trim() || rebase.stdout.trim() || "rebase failed"}).`,
    );
  }

  if (stashed) {
    const pop = await execGit({
      ...params,
      argv: ["git", "stash", "pop"],
    });
    if (pop.exitCode !== 0) {
      throw new GrantValidationError(
        "execution_failed",
        `git_signoff_range: signoff rebase succeeded but stash pop failed (${pop.stderr.trim() || "stash pop failed"}).`,
      );
    }
  }

  let pushed = false;
  if (input.push === true) {
    const pushArgv = [
      "git",
      "push",
      "--force-with-lease",
      remote,
      branch,
    ];
    const push = await execGit({
      ...params,
      argv: pushArgv,
    });
    if (push.exitCode !== 0) {
      throw new GrantValidationError(
        "execution_failed",
        `git_signoff_range: force-with-lease push failed (${push.stderr.trim() || "push failed"}).`,
      );
    }
    pushed = true;
  }

  const count = await execGit({
    ...params,
    argv: [
      "git",
      "log",
      "--format=%B",
      `${input.base}..HEAD`,
    ],
  });
  const signedOffCount =
    count.exitCode === 0
      ? (count.stdout.match(/^Signed-off-by:/gm) ?? []).length
      : undefined;

  const output = gitSignoffRangeOutputSchema.parse({
    argv: rebaseArgv,
    exitCode: rebase.exitCode,
    stdout: rebase.stdout,
    stderr: rebase.stderr,
    truncated: rebase.truncated || status.truncated || branchResult.truncated,
    stashed,
    pushed,
    branch,
    signedOffCount,
  });

  return {
    output,
    truncated: output.truncated,
    redacted: rebase.redacted || status.redacted || branchResult.redacted,
    timedOut: rebase.timedOut || status.timedOut || branchResult.timedOut,
    cancelled:
      rebase.cancelled || status.cancelled || branchResult.cancelled,
  };
}
