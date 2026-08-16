import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { NodeWorkspaceFileSystemAdapter } from "../index";

describe("NodeWorkspaceFileSystemAdapter.readTextFilesUnder", () => {
  it("reads a file root without throwing ENOTDIR", async () => {
    const root = await mkdtemp(join(tmpdir(), "mitii-search-file-"));
    try {
      const filePath = join(root, "useFormBuilder.ts");
      await writeFile(filePath, "export function useFormBuilder() { return {}; }\n");
      const adapter = new NodeWorkspaceFileSystemAdapter();
      const files = await adapter.readTextFilesUnder(filePath, {
        workspaceRoot: root,
        maxFiles: 10,
        maxFileBytes: 8_192,
      });
      expect(files).toHaveLength(1);
      expect(files[0]?.relativePath).toBe("useFormBuilder.ts");
      expect(files[0]?.content).toContain("return {}");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("walks a directory root", async () => {
    const root = await mkdtemp(join(tmpdir(), "mitii-search-dir-"));
    try {
      await mkdir(join(root, "src"));
      await writeFile(join(root, "src", "a.ts"), "export const a = 1;\n");
      const adapter = new NodeWorkspaceFileSystemAdapter();
      const files = await adapter.readTextFilesUnder(join(root, "src"), {
        workspaceRoot: root,
        maxFiles: 10,
        maxFileBytes: 8_192,
      });
      expect(files.map((file) => file.relativePath)).toEqual(["src/a.ts"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
