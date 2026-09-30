import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveLspSpawnInvocation } from "./resolveLspSpawn.js";

describe("resolveLspSpawnInvocation", () => {
  it("keeps absolute commands direct on unix", () => {
    const invocation = resolveLspSpawnInvocation({
      command: "/usr/local/bin/gopls",
      args: ["serve"],
      platform: "linux",
      pathEnv: "",
    });
    expect(invocation).toMatchObject({
      command: "/usr/local/bin/gopls",
      args: ["serve"],
      shell: false,
      windowsHide: false,
      resolution: "direct",
    });
  });

  it("resolves bare commands from PATH on unix", () => {
    const root = mkdtempSync(join(tmpdir(), "mitii-lsp-path-"));
    const bin = join(root, "bin");
    mkdirSync(bin);
    const gopls = join(bin, "gopls");
    writeFileSync(gopls, "#!/bin/sh\n", { mode: 0o755 });

    const invocation = resolveLspSpawnInvocation({
      command: "gopls",
      platform: "darwin",
      pathEnv: bin,
    });
    expect(invocation.command).toBe(gopls);
    expect(invocation.resolution).toBe("path");
    expect(invocation.shell).toBe(false);
  });

  it("wraps Windows .cmd shims via cmd.exe /c", () => {
    const root = mkdtempSync(join(tmpdir(), "mitii-lsp-cmd-"));
    const bin = join(root, "bin");
    mkdirSync(bin);
    const shim = join(bin, "typescript-language-server.cmd");
    writeFileSync(shim, "@echo off\n");

    const invocation = resolveLspSpawnInvocation({
      command: "typescript-language-server",
      args: ["--stdio"],
      platform: "win32",
      pathEnv: bin,
      pathext: ".EXE;.CMD;.BAT",
      comSpec: "C:\\Windows\\System32\\cmd.exe",
    });

    expect(invocation.command).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(invocation.args[0]).toBe("/d");
    expect(invocation.args[1]).toBe("/s");
    expect(invocation.args[2]).toBe("/c");
    expect(String(invocation.args[3]).toLowerCase()).toBe(shim.toLowerCase());
    expect(invocation.args[4]).toBe("--stdio");
    expect(invocation.shell).toBe(false);
    expect(invocation.windowsHide).toBe(true);
    expect(invocation.resolution).toBe("windows-shell-fallback");
  });

  it("spawns Windows .exe without shell", () => {
    const root = mkdtempSync(join(tmpdir(), "mitii-lsp-exe-"));
    const bin = join(root, "bin");
    mkdirSync(bin);
    const exe = join(bin, "clangd.exe");
    writeFileSync(exe, "");

    const invocation = resolveLspSpawnInvocation({
      command: "clangd",
      platform: "win32",
      pathEnv: bin,
      pathext: ".EXE;.CMD",
    });
    expect(invocation.command.toLowerCase()).toBe(exe.toLowerCase());
    expect(invocation.shell).toBe(false);
    expect(invocation.resolution).toBe("path");
  });
});
