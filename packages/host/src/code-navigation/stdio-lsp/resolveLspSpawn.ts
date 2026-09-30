import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

export type LspSpawnInvocation = {
  command: string;
  args: string[];
  shell: boolean;
  windowsHide: boolean;
  /** How the command was resolved — useful for tests/logs. */
  resolution: "direct" | "path" | "windows-cmd-shim" | "windows-shell-fallback";
};

/**
 * Resolve an LSP server command for cross-platform spawn.
 * On Windows, npm global shims are often `.cmd` — run them via `cmd.exe /c`
 * so Node can spawn them without shell:true (OpenClaw pattern).
 */
export function resolveLspSpawnInvocation(params: {
  command: string;
  args?: readonly string[];
  platform?: NodeJS.Platform;
  pathEnv?: string;
  pathext?: string;
  comSpec?: string;
}): LspSpawnInvocation {
  const platform = params.platform ?? process.platform;
  const args = [...(params.args ?? [])];
  const pathEnv = params.pathEnv ?? process.env.PATH ?? process.env.Path ?? "";
  const resolved = resolveExecutablePath({
    command: params.command,
    platform,
    pathEnv,
    pathext: params.pathext ?? process.env.PATHEXT,
  });

  if (platform !== "win32") {
    return {
      command: resolved.path,
      args,
      shell: false,
      windowsHide: false,
      resolution: resolved.fromPath ? "path" : "direct",
    };
  }

  const lower = resolved.path.toLowerCase();
  if (lower.endsWith(".cmd") || lower.endsWith(".bat")) {
    const comSpec = params.comSpec ?? process.env.ComSpec ?? "cmd.exe";
    return {
      command: comSpec,
      args: ["/d", "/s", "/c", resolved.path, ...args],
      shell: false,
      windowsHide: true,
      resolution: "windows-shell-fallback",
    };
  }

  return {
    command: resolved.path,
    args,
    shell: false,
    windowsHide: true,
    resolution: resolved.fromPath ? "path" : "direct",
  };
}

function resolveExecutablePath(params: {
  command: string;
  platform: NodeJS.Platform;
  pathEnv: string;
  pathext?: string;
}): { path: string; fromPath: boolean } {
  const command = params.command.trim();
  if (!command) {
    return { path: command, fromPath: false };
  }
  if (isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    return { path: command, fromPath: false };
  }

  const extensions =
    params.platform === "win32"
      ? (params.pathext ?? ".EXE;.CMD;.BAT;.COM")
          .split(";")
          .map((value) => value.trim())
          .filter(Boolean)
      : [""];

  for (const directory of params.pathEnv.split(delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate =
        params.platform === "win32" && extension && !hasExtension(command)
          ? join(directory, `${command}${extension}`)
          : join(directory, command);
      if (existsSync(candidate)) {
        return { path: candidate, fromPath: true };
      }
    }
    // Also try the bare name on Windows (already covered) and Unix.
    const bare = join(directory, command);
    if (existsSync(bare)) {
      return { path: bare, fromPath: true };
    }
  }

  return { path: command, fromPath: false };
}

function hasExtension(command: string): boolean {
  return /\.[A-Za-z0-9]+$/.test(command);
}
