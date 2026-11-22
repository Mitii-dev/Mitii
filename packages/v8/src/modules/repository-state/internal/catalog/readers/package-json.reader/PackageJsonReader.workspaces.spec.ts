import { describe, expect, it } from "vitest";

import { InMemoryFileSystemAdapter } from "../../../shared";
import type { WorkspaceFileEntry } from "../../../workspace";
import { PackageJsonReader } from "./PackageJsonReader";

describe("PackageJsonReader workspaces", () => {
  it("reads array and object workspace member patterns", async () => {
    const fileSystem = new InMemoryFileSystemAdapter([
      {
        kind: "file",
        path: "/workspace/package.json",
        content: JSON.stringify({
          name: "root",
          workspaces: ["packages/*", "apps/*"],
        }),
      },
      {
        kind: "file",
        path: "/workspace/packages/sdk/package.json",
        content: JSON.stringify({
          name: "@mitii/sdk",
          workspaces: { packages: ["../v8"] },
        }),
      },
    ]);
    const reader = new PackageJsonReader(fileSystem);

    const info = await reader.read({
      rootId: "workspace",
      relativeRoot: "",
      manifest: fileEntry("package.json"),
      projectEntries: [],
    });
    expect(info.workspaceMemberPatterns).toEqual(["apps/*", "packages/*"]);

    const nested = await reader.read({
      rootId: "workspace",
      relativeRoot: "packages/sdk",
      manifest: fileEntry("packages/sdk/package.json"),
      projectEntries: [],
    });
    expect(nested.workspaceMemberPatterns).toEqual(["../v8"]);
  });
});

function fileEntry(relativePath: string): WorkspaceFileEntry {
  return {
    kind: "file",
    rootId: "workspace",
    relativePath,
    providerPath: `/workspace/${relativePath}`,
    depth: relativePath.split("/").length,
  };
}
