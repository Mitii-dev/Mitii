import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { NodeManifestReader } from "..";

describe("NodeManifestReader", () => {
  it("reads trusted workspace-relative manifests", async () => {
    const root = await mkdtemp(join(tmpdir(), "mitii-manifest-"));
    try {
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ scripts: { test: "vitest run" } }),
        "utf8",
      );

      const reader = new NodeManifestReader(root);

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
      const reader = new NodeManifestReader(root);

      await expect(reader.exists("../package.json")).resolves.toBe(false);
      await expect(reader.readText("../package.json")).resolves.toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
