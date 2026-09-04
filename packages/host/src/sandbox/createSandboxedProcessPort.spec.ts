import { describe, expect, it } from "vitest";

import type { ProcessExecRequest, ProcessPort } from "@mitii/v8";

import {
  createSandboxedProcessPort,
  detectSandboxBackend,
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

  it("detectSandboxBackend reports a concrete id", () => {
    const backend = detectSandboxBackend();
    expect(["seatbelt", "bubblewrap", "unavailable"]).toContain(backend.id);
  });
});
