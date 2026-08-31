/**
 * Native GitHub issue / PR tools (Phase 2+).
 * Execute via `gh` argv — no shell. Decision Policy must grant the tool id.
 * Issues support fingerprint-based upsert (comment on existing).
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

/** Lightweight secret scrub for issue/PR bodies (mirrors automation redactor). */
function redactIssueText(text: string): string {
  return text
    .replace(/\bghp_[A-Za-z0-9]{36,}\b/g, "[REDACTED:gh_pat]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[REDACTED:github_pat]")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED:slack_token]")
    .replace(/\bsk-ant-[A-Za-z0-9\-_]{20,}\b/g, "[REDACTED:anthropic]")
    .replace(/\bsk-[A-Za-z0-9]{20,}\b/g, "[REDACTED:openai]")
    .replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [REDACTED]")
    .replace(
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
      "[REDACTED:private_key]",
    );
}

function ensureFingerprintInTitle(title: string, fingerprint?: string): string {
  if (!fingerprint) return title;
  const tag = `[mitii:${fingerprint}]`;
  if (title.includes(tag)) return title;
  return `${tag} ${title}`.slice(0, 256);
}

function ensureFingerprintInBody(body: string, fingerprint?: string): string {
  if (!fingerprint) return body;
  const key = `_Idempotent key: mitii-fingerprint:${fingerprint}_`;
  if (body.includes(`mitii-fingerprint:${fingerprint}`)) return body;
  return `${body.trim()}\n\n---\n${key}\n`;
}

async function findOpenIssueByFingerprint(params: {
  process: ProcessPort;
  workspaceRoot: string;
  fingerprint: string;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}): Promise<{ number: number; url?: string } | undefined> {
  const query = `"mitii:${params.fingerprint}" in:title is:open`;
  const result = await params.process.execFile({
    argv: [
      "gh",
      "issue",
      "list",
      "--search",
      query,
      "--state",
      "open",
      "--limit",
      "5",
      "--json",
      "number,url,title",
    ],
    cwd: params.workspaceRoot,
    timeoutMs: params.timeoutMs,
    maxOutputBytes: params.maxOutputBytes,
    signal: params.signal,
  });
  if (result.exitCode !== 0) return undefined;
  try {
    const rows = JSON.parse(result.stdout || "[]") as Array<{
      number: number;
      url?: string;
      title?: string;
    }>;
    const tag = `[mitii:${params.fingerprint}]`;
    const hit = rows.find((r) => (r.title ?? "").includes(tag)) ?? rows[0];
    if (!hit?.number) return undefined;
    return { number: hit.number, url: hit.url };
  } catch {
    return undefined;
  }
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
  const title = ensureFingerprintInTitle(input.title, input.fingerprint);
  const body = redactIssueText(
    ensureFingerprintInBody(input.body, input.fingerprint),
  );

  if (input.fingerprint) {
    const existing = await findOpenIssueByFingerprint({
      process: params.process,
      workspaceRoot: params.workspaceRoot,
      fingerprint: input.fingerprint,
      timeoutMs: params.timeoutMs,
      maxOutputBytes: params.maxOutputBytes,
      signal: params.signal,
    });
    if (existing) {
      const argv = [
        "gh",
        "issue",
        "comment",
        String(existing.number),
        "--body",
        body,
      ];
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
        url: extractUrl(stdout.text) ?? existing.url,
        created: false,
        issueNumber: existing.number,
      });
      return {
        output,
        truncated: output.truncated,
        redacted: true,
        timedOut: result.timedOut,
        cancelled: result.cancelled,
      };
    }
  }

  const argv = ["gh", "issue", "create", "--title", title, "--body", body];
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
    created: true,
  });
  return {
    output,
    truncated: output.truncated,
    redacted: true,
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
  if (isProtectedBranch(input.head)) {
    throw new GrantValidationError(
      "invalid_arguments",
      "create_pull_request: refusing to open a PR with head branch main/master.",
    );
  }

  const body = redactIssueText(input.body);
  const argv = [
    "gh",
    "pr",
    "create",
    "--title",
    input.title,
    "--body",
    body,
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
    created: true,
  });
  return {
    output,
    truncated: output.truncated,
    redacted: true,
    timedOut: result.timedOut,
    cancelled: result.cancelled,
  };
}

export function isProtectedBranch(ref: string): boolean {
  const name = ref.replace(/^refs\/heads\//, "").replace(/^origin\//, "");
  return (
    name === "main" ||
    name === "master" ||
    name.endsWith("/main") ||
    name.endsWith("/master")
  );
}

/**
 * Block `git push` (and force-push) targeting protected default branches.
 */
export function assertSafeGitPushArgv(argv: string[]): void {
  if (argv.length < 2) return;
  if (argv[0] !== "git") return;
  const pushIdx = argv.findIndex((a) => a === "push");
  if (pushIdx < 0) return;
  const rest = argv.slice(pushIdx + 1).filter((a) => !a.startsWith("-"));
  // Forms: git push, git push origin, git push origin main, git push origin HEAD:main
  for (const part of rest) {
    const ref = part.includes(":") ? part.split(":").pop()! : part;
    if (isProtectedBranch(ref)) {
      throw new GrantValidationError(
        "command_not_allowed",
        `Refusing git push to protected branch "${ref}". Use a feature branch + create_pull_request.`,
      );
    }
  }
  // Bare `git push` / `git push origin` with upstream tracking main is still risky;
  // require an explicit non-protected ref when pushing.
  if (rest.length <= 1) {
    throw new GrantValidationError(
      "command_not_allowed",
      "Refusing ambiguous git push without an explicit non-main ref. Push a feature branch instead.",
    );
  }
}
