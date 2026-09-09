/**
 * OS process sandbox for Mitii hosts.
 *
 * Wraps ProcessPort so approved commands still cannot write outside the
 * workspace or open arbitrary network (when network=deny).
 *
 * Default: disabled. When enabled on an unsupported platform or missing
 * backend binary, execution FAILS CLOSED (does not run unrestricted).
 */

import { spawnSync } from "node:child_process";
import { platform } from "node:os";

import type { ProcessExecRequest, ProcessExecResult, ProcessPort } from "@mitii/v8";

export type SandboxNetworkMode = "deny" | "allow";

export interface SandboxPolicy {
  /** Master switch. Default false. */
  enabled: boolean;
  /** Outbound network for sandboxed children. Default deny. */
  network: SandboxNetworkMode;
  /** Extra writable absolute paths beyond the workspace. */
  writablePaths?: string[];
  /** Workspace root — required when enabled. */
  workspaceRoot: string;
}

export interface SandboxBackend {
  readonly id: "seatbelt" | "bubblewrap" | "unavailable";
  readonly available: boolean;
  readonly reason?: string;
  wrap(request: ProcessExecRequest, policy: SandboxPolicy): ProcessExecRequest;
}

export class SandboxUnavailableError extends Error {
  readonly code = "sandbox_unavailable";
  constructor(message: string) {
    super(message);
    this.name = "SandboxUnavailableError";
  }
}

export function detectSandboxBackend(): SandboxBackend {
  const os = platform();
  if (os === "darwin") {
    const seatbelt = resolveSeatbeltBackend();
    if (seatbelt.available) return seatbelt;
    return {
      id: "unavailable",
      available: false,
      reason: seatbelt.reason ?? "macOS sandbox-exec unavailable",
      wrap: failWrap,
    };
  }
  if (os === "linux") {
    const bwrap = resolveBubblewrapBackend();
    if (bwrap.available) return bwrap;
    return {
      id: "unavailable",
      available: false,
      reason: bwrap.reason ?? "Linux bwrap unavailable",
      wrap: failWrap,
    };
  }
  return {
    id: "unavailable",
    available: false,
    reason: `OS sandbox is not supported on ${os}`,
    wrap: failWrap,
  };
}

function failWrap(
  _request: ProcessExecRequest,
  _policy: SandboxPolicy,
): ProcessExecRequest {
  throw new SandboxUnavailableError("Sandbox backend cannot wrap process");
}

function commandExists(bin: string): boolean {
  const probe = spawnSync(bin, ["--help"], {
    encoding: "utf8",
    timeout: 2000,
    shell: false,
  });
  // --help often exits non-zero; existence matters more than exit code.
  return probe.error === undefined;
}

function resolveSeatbeltBackend(): SandboxBackend {
  // sandbox-exec is present on macOS; profile is generated per call.
  const available = platform() === "darwin";
  return {
    id: "seatbelt",
    available,
    reason: available ? undefined : "not macOS",
    wrap(request, policy) {
      const profile = buildSeatbeltProfile(policy);
      const [command, ...args] = request.argv;
      if (!command) return request;
      return {
        ...request,
        argv: [
          "/usr/bin/sandbox-exec",
          "-p",
          profile,
          command,
          ...args,
        ],
      };
    },
  };
}

function buildSeatbeltProfile(policy: SandboxPolicy): string {
  const writable = [
    policy.workspaceRoot,
    ...(policy.writablePaths ?? []),
    "/tmp",
    "/private/tmp",
    "/var/folders",
  ];
  const writeRules = writable
    .map(
      (path) =>
        `(allow file-write* (subpath ${JSON.stringify(path)}))`,
    )
    .join("\n  ");
  const networkRule =
    policy.network === "allow"
      ? "(allow network*)"
      : "(deny network*)";
  return `
(version 1)
(deny default)
(allow process-exec)
(allow process-fork)
(allow sysctl-read)
(allow file-read*)
(allow file-write-data (literal "/dev/null"))
${writeRules}
${networkRule}
`.trim();
}

function resolveBubblewrapBackend(): SandboxBackend {
  const available = commandExists("bwrap");
  return {
    id: "bubblewrap",
    available,
    reason: available ? undefined : "bwrap not found on PATH",
    wrap(request, policy) {
      const [command, ...args] = request.argv;
      if (!command) return request;
      const bindArgs: string[] = [
        "--die-with-parent",
        "--ro-bind",
        "/",
        "/",
        "--bind",
        policy.workspaceRoot,
        policy.workspaceRoot,
        "--tmpfs",
        "/tmp",
      ];
      for (const extra of policy.writablePaths ?? []) {
        bindArgs.push("--bind", extra, extra);
      }
      if (policy.network === "deny") {
        bindArgs.push("--unshare-net");
      }
      return {
        ...request,
        argv: ["bwrap", ...bindArgs, command, ...args],
      };
    },
  };
}

/**
 * Wrap an inner ProcessPort with OS sandbox policy.
 * When policy.enabled is false, calls pass through unchanged.
 * When enabled and backend unavailable, fails closed.
 */
export function createSandboxedProcessPort(
  inner: ProcessPort,
  policy: SandboxPolicy,
  backend: SandboxBackend = detectSandboxBackend(),
): ProcessPort {
  return {
    execFile(request: ProcessExecRequest): Promise<ProcessExecResult> {
      if (!policy.enabled) {
        return inner.execFile(request);
      }
      if (!backend.available) {
        return Promise.resolve({
          exitCode: null,
          stdout: "",
          stderr: `mitii sandbox fail-closed: ${backend.reason ?? "unavailable"}`,
          timedOut: false,
          cancelled: false,
          truncated: false,
        });
      }
      try {
        const wrapped = backend.wrap(request, policy);
        return inner.execFile(wrapped);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return Promise.resolve({
          exitCode: null,
          stdout: "",
          stderr: `mitii sandbox fail-closed: ${message}`,
          timedOut: false,
          cancelled: false,
          truncated: false,
        });
      }
    },
  };
}

export function resolveSandboxPolicy(options: {
  enabled?: boolean;
  network?: SandboxNetworkMode;
  writablePaths?: string[];
  workspaceRoot: string;
}): SandboxPolicy {
  return {
    enabled: options.enabled === true,
    network: options.network === "allow" ? "allow" : "deny",
    writablePaths: options.writablePaths ?? [],
    workspaceRoot: options.workspaceRoot,
  };
}
