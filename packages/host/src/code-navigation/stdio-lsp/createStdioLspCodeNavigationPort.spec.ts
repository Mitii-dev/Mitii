import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createStdioLspCodeNavigationPort } from "../createStdioLspCodeNavigationPort.js";
import { createHostLanguageServices } from "../createHostLanguageServices.js";

const fakeServer = fileURLToPath(
  new URL("./fakeLspServer.mjs", import.meta.url),
);

describe("createStdioLspCodeNavigationPort", () => {
  it("starts a stdio server lazily and resolves definition/hover", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "mitii-stdio-lsp-"));
    try {
      await mkdir(join(workspaceRoot, "src"), { recursive: true });
      await writeFile(join(workspaceRoot, "src/mod.py"), "value = 1\n", "utf8");

      const port = createStdioLspCodeNavigationPort({
        workspaceRoot,
        servers: [
          {
            id: "fake-py",
            command: process.execPath,
            args: [fakeServer],
            extensions: [".py"],
            languageId: "python",
          },
        ],
      });

      try {
        await port.prepare("src/mod.py");
        const definitions = await port.definition({
          relativePath: "src/mod.py",
          line: 1,
          column: 1,
        });
        expect(definitions[0]?.relativePath).toBe("src/mod.py");
        expect(definitions[0]?.startLine).toBe(1);

        const hover = await port.hover({
          relativePath: "src/mod.py",
          line: 1,
          column: 1,
        });
        expect(hover?.contents).toContain("fake hover");
        expect(port.capability().status).toBe("available");
      } finally {
        await port.dispose();
      }
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("aborts startup when the abort signal fires before initialize", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "mitii-stdio-abort-"));
    const controller = new AbortController();
    controller.abort();
    try {
      await mkdir(join(workspaceRoot, "src"), { recursive: true });
      await writeFile(join(workspaceRoot, "src/mod.py"), "value = 1\n", "utf8");
      const port = createStdioLspCodeNavigationPort({
        workspaceRoot,
        abortSignal: controller.signal,
        servers: [
          {
            id: "fake-py",
            command: process.execPath,
            args: [fakeServer],
            extensions: [".py"],
          },
        ],
      });
      try {
        const definitions = await port.definition({
          relativePath: "src/mod.py",
          line: 1,
          column: 1,
        });
        // Failed start marks server broken → empty (graph fallback owns recovery).
        expect(definitions).toEqual([]);
      } finally {
        await port.dispose();
      }
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

describe("createHostLanguageServices + lspServers", () => {
  it("attaches configured stdio servers when no tsconfig is present", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "mitii-host-stdio-"));
    try {
      await mkdir(join(workspaceRoot, "src"), { recursive: true });
      await writeFile(join(workspaceRoot, "src/mod.py"), "value = 1\n", "utf8");
      const services = createHostLanguageServices({
        workspaceRoot,
        lspServers: [
          {
            id: "fake-py",
            command: process.execPath,
            args: [fakeServer],
            extensions: [".py"],
          },
        ],
      });
      try {
        expect(services.capability.reason).toBe("stdio_lsp_configured");
        const definitions = await services.codeNavigation.definition({
          relativePath: "src/mod.py",
          line: 1,
          column: 1,
        });
        expect(definitions[0]?.relativePath).toBe("src/mod.py");
      } finally {
        services.dispose();
      }
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
