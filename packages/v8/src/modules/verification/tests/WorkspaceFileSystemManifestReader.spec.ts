import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { NodeWorkspaceFileSystemAdapter } from "../../../engine/tool-runtime";

import { WorkspaceFileSystemManifestReader } from "..";

describe("WorkspaceFileSystemManifestReader", () => {
  it("reads trusted workspace-relative manifests", async () => {
    const root = await mkdtemp(join(tmpdir(), "mitii-manifest-"));
    try {
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ scripts: { test: "vitest run" } }),
        "utf8",
      );

      const reader = new WorkspaceFileSystemManifestReader({
        fileSystem: new NodeWorkspaceFileSystemAdapter(),
        workspaceRoot: root,
      });

      await expect(reader.exists("package.json")).resolves.toBe(true);
      await expect(reader.readText("package.json")).resolves.toContain(
        "vitest run",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses paths that escape the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "mitii-manifest-"));
    try {
      const reader = new WorkspaceFileSystemManifestReader({
        fileSystem: new NodeWorkspaceFileSystemAdapter(),
        workspaceRoot: root,
      });

      await expect(reader.exists("../package.json")).resolves.toBe(false);
      await expect(reader.readText("../package.json")).resolves.toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses symlink escapes", async () => {
    const root = await mkdtemp(join(tmpdir(), "mitii-manifest-"));
    const outside = await mkdtemp(join(tmpdir(), "mitii-manifest-outside-"));
    try {
      await writeFile(join(outside, "package.json"), "{}", "utf8");
      await symlink(
        join(outside, "package.json"),
        join(root, "package-link.json"),
      );

      const reader = new WorkspaceFileSystemManifestReader({
        fileSystem: new NodeWorkspaceFileSystemAdapter(),
        workspaceRoot: root,
      });

      await expect(reader.exists("package-link.json")).resolves.toBe(false);
      await expect(reader.readText("package-link.json")).resolves.toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
