import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { discoverStdioLspServers } from "./discoverStdioLspServers.js";

describe("discoverStdioLspServers", () => {
  it("returns configs for binaries found on PATH", () => {
    const root = mkdtempSync(join(tmpdir(), "mitii-discover-lsp-"));
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "gopls"), "#!/bin/sh\n", { mode: 0o755 });
    writeFileSync(join(bin, "rust-analyzer"), "#!/bin/sh\n", { mode: 0o755 });

    const found = discoverStdioLspServers({
      pathEnv: bin,
      platform: "darwin",
      include: ["gopls", "rust-analyzer", "pyright"],
    });

    expect(found.map((server) => server.id).sort()).toEqual([
      "gopls",
      "rust-analyzer",
    ]);
    expect(found.find((server) => server.id === "gopls")).toMatchObject({
      command: join(bin, "gopls"),
      extensions: [".go"],
      languageId: "go",
    });
  });

  it("returns empty when nothing matches", () => {
    expect(
      discoverStdioLspServers({
        pathEnv: "/definitely/missing/mitii-path",
        platform: "linux",
        include: ["clangd"],
      }),
    ).toEqual([]);
  });
});
