import { describe, expect, it } from "vitest";

import type { ProcessExecRequest, ProcessPort } from "@mitii/v8";

import {
  createSandboxedProcessPort,
  detectSandboxBackend,
  resolveDockerBackend,
  resolveSandboxPolicy,
} from "./createSandboxedProcessPort.js";

class RecordingProcessPort implements ProcessPort {
  public last?: ProcessExecRequest;
  execFile(request: ProcessExecRequest) {
    this.last = request;
    return Promise.resolve({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      timedOut: false,
      cancelled: false,
      truncated: false,
    });
  }
}

describe("createSandboxedProcessPort", () => {
  it("passes through when disabled", async () => {
    const inner = new RecordingProcessPort();
    const port = createSandboxedProcessPort(
      inner,
      resolveSandboxPolicy({
        enabled: false,
        workspaceRoot: "/tmp/ws",
      }),
    );
    await port.execFile({
      argv: ["echo", "hi"],
      cwd: "/tmp/ws",
      env: {},
      timeoutMs: 1000,
      maxOutputBytes: 1024,
    });
    expect(inner.last?.argv).toEqual(["echo", "hi"]);
  });

  it("fails closed when enabled but backend unavailable", async () => {
    const inner = new RecordingProcessPort();
    const port = createSandboxedProcessPort(
      inner,
      resolveSandboxPolicy({
        enabled: true,
        workspaceRoot: "/tmp/ws",
      }),
      {
        id: "unavailable",
        available: false,
        reason: "test backend missing",
        wrap: () => {
          throw new Error("should not wrap");
        },
      },
    );
    const result = await port.execFile({
      argv: ["echo", "hi"],
      cwd: "/tmp/ws",
      env: {},
      timeoutMs: 1000,
      maxOutputBytes: 1024,
    });
    expect(result.exitCode).toBeNull();
    expect(result.stderr).toContain("fail-closed");
    expect(inner.last).toBeUndefined();
  });

  it("fails closed when docker backend is unavailable", async () => {
    const inner = new RecordingProcessPort();
    const port = createSandboxedProcessPort(
      inner,
      resolveSandboxPolicy({
        enabled: true,
        workspaceRoot: "/tmp/ws",
      }),
      {
        id: "docker",
        available: false,
        reason: "docker not found on PATH",
        wrap: () => {
          throw new Error("should not wrap");
        },
      },
    );
    const result = await port.execFile({
      argv: ["echo", "hi"],
      cwd: "/tmp/ws",
      env: {},
      timeoutMs: 1000,
      maxOutputBytes: 1024,
    });
    expect(result.exitCode).toBeNull();
    expect(result.stderr).toContain("fail-closed");
    expect(result.stderr).toContain("docker");
    expect(inner.last).toBeUndefined();
  });

  it("detectSandboxBackend reports a concrete id from the union", () => {
    const backend = detectSandboxBackend();
    expect([
      "seatbelt",
      "bubblewrap",
      "docker",
      "podman",
      "unavailable",
    ]).toContain(backend.id);
  });

  it("prefer docker uses docker id (fail-closed when missing)", () => {
    const backend = detectSandboxBackend({ prefer: "docker" });
    expect(backend.id).toBe("docker");
    if (!backend.available) {
      expect(backend.reason).toMatch(/docker/i);
    }
  });

  it("resolveDockerBackend wraps with docker run --rm -i", () => {
    const backend = resolveDockerBackend("docker");
    if (!backend.available) {
      expect(backend.id).toBe("docker");
      return;
    }
    const wrapped = backend.wrap(
      {
        argv: ["echo", "hi"],
        cwd: "/tmp/ws",
        env: {},
        timeoutMs: 1000,
        maxOutputBytes: 1024,
      },
      resolveSandboxPolicy({
        enabled: true,
        network: "deny",
        workspaceRoot: "/tmp/ws",
      }),
    );
    expect(wrapped.argv[0]).toBe("docker");
    expect(wrapped.argv.slice(1, 4)).toEqual(["run", "--rm", "-i"]);
    expect(wrapped.argv).toContain("--network");
    expect(wrapped.argv).toContain("none");
    expect(wrapped.argv).toContain("-v");
    expect(wrapped.argv).toContain("/tmp/ws:/tmp/ws");
    expect(wrapped.argv).toContain("-w");
  });
});
