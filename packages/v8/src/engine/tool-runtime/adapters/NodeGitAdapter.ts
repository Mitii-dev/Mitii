import { spawn } from "node:child_process";

import type {
  GitBranchListResult,
  GitDiffResult,
  GitLogResult,
  GitPort,
  GitShowResult,
  GitStatusResult,
} from "../contracts";
import {
  appendPathsAfterDoubleDash,
  assertSafeGitArg,
} from "../internal/GitArgSafety";

const DEFAULT_MAX_OUTPUT_BYTES = 512_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const LOG_RECORD_SEP = "\x1e";
const LOG_FIELD_SEP = "\x1f";

/**
 * Argv-only git for host wiring (Verification + git read tools).
 */
export class NodeGitAdapter implements GitPort {
  constructor(
    private readonly options: {
      maxOutputBytes?: number;
      timeoutMs?: number;
    } = {},
  ) {}

  public async status(params: {
    workspaceRoot: string;
    signal?: AbortSignal;
  }): Promise<GitStatusResult> {
    const raw = await this.runGit(
      ["status", "--porcelain=v1", "--branch"],
      params.workspaceRoot,
      params.signal,
    );
    return parsePorcelainStatus(raw);
  }

  public async diff(params: {
    workspaceRoot: string;
    paths?: readonly string[];
    staged?: boolean;
    signal?: AbortSignal;
  }): Promise<GitDiffResult> {
    let argv = ["diff", "--no-color"];
    if (params.staged) {
      argv.push("--cached");
    }
    if (params.paths && params.paths.length > 0) {
      argv = appendPathsAfterDoubleDash(argv, params.paths);
    }
    const diff = await this.runGit(argv, params.workspaceRoot, params.signal);
    return truncateText(diff, this.options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES);
  }

  public async log(params: {
    workspaceRoot: string;
    maxCount?: number;
    paths?: readonly string[];
    signal?: AbortSignal;
  }): Promise<GitLogResult> {
    const maxCount = Math.min(Math.max(params.maxCount ?? 20, 1), 100);
    let argv = [
      "log",
      `--max-count=${maxCount}`,
      `--pretty=format:%H${LOG_FIELD_SEP}%s${LOG_FIELD_SEP}%an${LOG_FIELD_SEP}%ae${LOG_FIELD_SEP}%aI${LOG_RECORD_SEP}`,
    ];
    if (params.paths && params.paths.length > 0) {
      argv = appendPathsAfterDoubleDash(argv, params.paths);
    }
    const raw = await this.runGit(argv, params.workspaceRoot, params.signal);
    const entries = raw
      .split(LOG_RECORD_SEP)
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length > 0)
      .map((chunk) => {
        const [hash, subject, authorName, authorEmail, authoredAt] =
          chunk.split(LOG_FIELD_SEP);
        return {
          hash: hash ?? "",
          subject: subject ?? "",
          ...(authorName ? { authorName } : {}),
          ...(authorEmail ? { authorEmail } : {}),
          ...(authoredAt ? { authoredAt } : {}),
        };
      })
      .filter((entry) => entry.hash.length > 0);
    return { entries, truncated: false };
  }

  public async show(params: {
    workspaceRoot: string;
    revision: string;
    path?: string;
    signal?: AbortSignal;
  }): Promise<GitShowResult> {
    assertSafeGitArg(params.revision, "git revision");
    const argv = ["show", "--no-color", params.revision];
    if (params.path) {
      assertSafeGitArg(params.path, "git path");
      argv.push("--", params.path);
    }
    const content = await this.runGit(
      argv,
      params.workspaceRoot,
      params.signal,
    );
    const truncated = truncateText(
      content,
      this.options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    );
    return {
      revision: params.revision,
      content: truncated.diff,
      truncated: truncated.truncated,
    };
  }

  public async listBranches(params: {
    workspaceRoot: string;
    signal?: AbortSignal;
  }): Promise<GitBranchListResult> {
    const raw = await this.runGit(
      ["branch", "--format=%(refname:short)"],
      params.workspaceRoot,
      params.signal,
    );
    const branches = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    for (const branch of branches) {
      assertSafeGitArg(branch, "git branch");
    }
    let current: string | undefined;
    try {
      current = (
        await this.runGit(
          ["branch", "--show-current"],
          params.workspaceRoot,
          params.signal,
        )
      ).trim();
      if (!current) current = undefined;
    } catch {
      current = undefined;
    }
    return { current, branches, truncated: false };
  }

  private runGit(
    argv: string[],
    cwd: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const maxOutputBytes =
      this.options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      let timedOut = false;
      let stdout = "";
      let stderr = "";
      let bytes = 0;

      const child = spawn("git", argv, {
        cwd,
        shell: false,
        windowsHide: true,
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);

      const onAbort = (): void => {
        child.kill("SIGKILL");
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      const append = (chunk: Buffer, current: string): string => {
        if (bytes >= maxOutputBytes) {
          return current;
        }
        const remaining = maxOutputBytes - bytes;
        const slice =
          chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
        bytes += slice.byteLength;
        return current + slice.toString("utf8");
      };

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout = append(chunk, stdout);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr = append(chunk, stderr);
      });

      child.on("error", (error) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (signal?.aborted) {
          reject(new Error("git cancelled"));
          return;
        }
        if (timedOut) {
          reject(new Error("git timed out"));
          return;
        }
        if (code !== 0) {
          reject(
            new Error(
              stderr.trim() || `git ${argv.join(" ")} exited with ${code}`,
            ),
          );
          return;
        }
        resolve(stdout);
      });
    });
  }
}

function truncateText(
  text: string,
  max: number,
): { diff: string; truncated: boolean } {
  if (Buffer.byteLength(text, "utf8") > max) {
    return {
      diff: Buffer.from(text, "utf8").subarray(0, max).toString("utf8"),
      truncated: true,
    };
  }
  return { diff: text, truncated: false };
}

function parsePorcelainStatus(raw: string): GitStatusResult {
  const lines = raw.split(/\r?\n/).filter((line) => line.length > 0);
  let branch: string | undefined;
  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      const head = line.slice(3);
      const branchPart = head.split("...")[0]?.trim();
      if (branchPart) {
        branch = branchPart.replace(/^No commits yet on /, "");
      }
      continue;
    }

    if (line.startsWith("?? ")) {
      untracked.push(line.slice(3).trim());
      continue;
    }

    if (line.length < 3) {
      continue;
    }

    const indexStatus = line[0];
    const workTreeStatus = line[1];
    const pathPart = line.slice(3).trim();
    const path = pathPart.includes(" -> ")
      ? pathPart.split(" -> ").at(-1)!.trim()
      : pathPart;

    if (indexStatus && indexStatus !== " " && indexStatus !== "?") {
      staged.push(path);
    }
    if (workTreeStatus && workTreeStatus !== " " && workTreeStatus !== "?") {
      unstaged.push(path);
    }
  }

  return { branch, staged, unstaged, untracked, raw };
}
