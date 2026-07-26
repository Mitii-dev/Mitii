import { spawn } from "node:child_process";

import type { ProcessExecRequest, ProcessExecResult, ProcessPort } from "../contracts";

/**
 * Argv-only process execution. Never passes a shell command string.
 */
export class NodeProcessAdapter implements ProcessPort {
  public execFile(request: ProcessExecRequest): Promise<ProcessExecResult> {
    const [command, ...args] = request.argv;
    if (!command) {
      return Promise.resolve({
        exitCode: null,
        stdout: "",
        stderr: "Empty argv",
        timedOut: false,
        cancelled: false,
        truncated: false,
      });
    }

    return new Promise((resolve) => {
      let timedOut = false;
      let cancelled = false;
      let truncated = false;
      let stdout = "";
      let stderr = "";
      let stdoutBytes = 0;
      let stderrBytes = 0;

      const child = spawn(command, args, {
        cwd: request.cwd,
        env: request.env as NodeJS.ProcessEnv,
        shell: false,
        windowsHide: true,
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, request.timeoutMs);

      const onAbort = (): void => {
        cancelled = true;
        child.kill("SIGKILL");
      };
      request.signal?.addEventListener("abort", onAbort, { once: true });

      const append = (
        chunk: Buffer,
        current: string,
        bytes: number,
      ): { text: string; bytes: number } => {
        if (bytes >= request.maxOutputBytes) {
          truncated = true;
          return { text: current, bytes };
        }
        const remaining = request.maxOutputBytes - bytes;
        if (chunk.byteLength > remaining) {
          truncated = true;
          return {
            text: current + chunk.subarray(0, remaining).toString("utf8"),
            bytes: request.maxOutputBytes,
          };
        }
        return {
          text: current + chunk.toString("utf8"),
          bytes: bytes + chunk.byteLength,
        };
      };

      child.stdout?.on("data", (chunk: Buffer) => {
        const next = append(chunk, stdout, stdoutBytes);
        stdout = next.text;
        stdoutBytes = next.bytes;
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        const next = append(chunk, stderr, stderrBytes);
        stderr = next.text;
        stderrBytes = next.bytes;
      });

      child.on("error", (error) => {
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", onAbort);
        resolve({
          exitCode: null,
          stdout,
          stderr: stderr || error.message,
          timedOut,
          cancelled,
          truncated,
        });
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", onAbort);
        resolve({
          exitCode: code,
          stdout,
          stderr,
          timedOut,
          cancelled,
          truncated,
        });
      });
    });
  }
}
