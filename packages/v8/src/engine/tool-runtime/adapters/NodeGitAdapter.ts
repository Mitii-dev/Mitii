import { spawn } from "node:child_process";

import type { GitDiffResult, GitPort, GitStatusResult } from "../contracts";

const DEFAULT_MAX_OUTPUT_BYTES = 512_000;
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Argv-only git status/diff for host wiring (Verification + read_git_status).
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
    const argv = ["diff", "--no-color"];
    if (params.staged) {
      argv.push("--cached");
    }
    if (params.paths && params.paths.length > 0) {
      argv.push("--", ...params.paths);
    }
    const diff = await this.runGit(argv, params.workspaceRoot, params.signal);
    const max = this.options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    if (Buffer.byteLength(diff, "utf8") > max) {
      return {
        diff: Buffer.from(diff, "utf8").subarray(0, max).toString("utf8"),
        truncated: true,
      };
    }
    return { diff, truncated: false };
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
