import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

import type { StdioLspServerConfig } from "../createStdioLspCodeNavigationPort.js";

type DiscoverableServer = Omit<StdioLspServerConfig, "command"> & {
  /** Binary names to look up on PATH (first hit wins). */
  binaries: readonly string[];
};

/**
 * Well-known language servers. Discovery is opt-in and never auto-spawns
 * without the host passing the result into createHostLanguageServices.
 */
const DISCOVERABLE_SERVERS: readonly DiscoverableServer[] = [
  {
    id: "typescript",
    binaries: ["typescript-language-server"],
    args: ["--stdio"],
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
    languageId: "typescript",
  },
  {
    id: "pyright",
    binaries: ["pyright-langserver", "pyright"],
    args: ["--stdio"],
    extensions: [".py", ".pyi"],
    languageId: "python",
  },
  {
    id: "gopls",
    binaries: ["gopls"],
    extensions: [".go"],
    languageId: "go",
  },
  {
    id: "rust-analyzer",
    binaries: ["rust-analyzer"],
    extensions: [".rs"],
    languageId: "rust",
  },
  {
    id: "clangd",
    binaries: ["clangd"],
    extensions: [".c", ".cc", ".cpp", ".cxx", ".h", ".hpp"],
    languageId: "cpp",
  },
];

/**
 * Probe PATH for known stdio language servers and return configs the host can
 * pass to `createHostLanguageServices({ lspServers })`.
 * Does not spawn processes — discovery only.
 */
export function discoverStdioLspServers(options: {
  pathEnv?: string;
  platform?: NodeJS.Platform;
  pathext?: string;
  /** Limit which server ids are considered. */
  include?: readonly string[];
} = {}): StdioLspServerConfig[] {
  const pathEnv = options.pathEnv ?? process.env.PATH ?? process.env.Path ?? "";
  const platform = options.platform ?? process.platform;
  const include = options.include ? new Set(options.include) : undefined;
  const found: StdioLspServerConfig[] = [];

  for (const server of DISCOVERABLE_SERVERS) {
    if (include && !include.has(server.id)) continue;
    const command = findBinaryOnPath({
      binaries: server.binaries,
      pathEnv,
      platform,
      pathext: options.pathext ?? process.env.PATHEXT,
    });
    if (!command) continue;
    found.push({
      id: server.id,
      command,
      ...(server.args ? { args: server.args } : {}),
      extensions: server.extensions,
      ...(server.languageId ? { languageId: server.languageId } : {}),
      ...(server.initialization
        ? { initialization: server.initialization }
        : {}),
      ...(server.env ? { env: server.env } : {}),
      ...(server.requestTimeoutMs
        ? { requestTimeoutMs: server.requestTimeoutMs }
        : {}),
    });
  }

  return found;
}

function findBinaryOnPath(params: {
  binaries: readonly string[];
  pathEnv: string;
  platform: NodeJS.Platform;
  pathext?: string;
}): string | undefined {
  const extensions =
    params.platform === "win32"
      ? (params.pathext ?? ".EXE;.CMD;.BAT;.COM")
          .split(";")
          .map((value) => value.trim())
          .filter(Boolean)
      : [""];

  for (const binary of params.binaries) {
    for (const directory of params.pathEnv.split(delimiter)) {
      if (!directory) continue;
      for (const extension of extensions) {
        const candidate =
          params.platform === "win32" &&
          extension &&
          !/\.[A-Za-z0-9]+$/.test(binary)
            ? join(directory, `${binary}${extension}`)
            : join(directory, binary);
        if (existsSync(candidate)) {
          return candidate;
        }
      }
      const bare = join(directory, binary);
      if (existsSync(bare)) return bare;
    }
  }
  return undefined;
}
