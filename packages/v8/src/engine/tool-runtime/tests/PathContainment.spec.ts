import { mkdir, mkdtemp, realpath as fsRealpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import type { WorkspaceFileSystemPort } from "../contracts";
import { NodeWorkspaceFileSystemAdapter } from "../index";
import {
  PathContainmentError,
  resolveContainedPath,
} from "../internal/PathContainment";

/**
 * Simulates OS alias roots (e.g. macOS `/var` → `/private/var`) without
 * requiring the host temp dir to use that layout.
 */
function createAliasedRootFileSystem(params: {
  logicalRoot: string;
  physicalRoot: string;
  files?: ReadonlySet<string>;
  directories?: ReadonlySet<string>;
  escapes?: ReadonlyMap<string, string>;
}): WorkspaceFileSystemPort {
  const {
    logicalRoot,
    physicalRoot,
    files = new Set(["app/layout.tsx"]),
    directories = new Set(["", "app"]),
    escapes = new Map([["escape", "/etc/passwd"]]),
  } = params;

  const toRelative = (absolutePath: string): string | null => {
    const resolved = path.resolve(absolutePath);
    if (resolved === logicalRoot) return "";
    if (resolved.startsWith(`${logicalRoot}${path.sep}`)) {
      return resolved.slice(logicalRoot.length + 1).replace(/\\/g, "/");
    }
    return null;
  };

  const toPhysical = (relative: string): string =>
    relative === ""
      ? physicalRoot
      : path.join(physicalRoot, ...relative.split("/"));

  const notImplemented = async (): Promise<never> => {
    throw new Error("not implemented");
  };

  return {
    resolve(workspaceRoot, relativePath) {
      return path.resolve(workspaceRoot, relativePath);
    },
    async lstat(absolutePath) {
      const relative = toRelative(absolutePath);
      if (relative === null) {
        throw new Error(`ENOENT: ${absolutePath}`);
      }
      if (escapes.has(relative)) {
        return { kind: "symlink", sizeBytes: 0, isSymlink: true, mtimeMs: 0 };
      }
      if (directories.has(relative)) {
        return { kind: "directory", sizeBytes: 0, isSymlink: false, mtimeMs: 0 };
      }
      if (files.has(relative)) {
        return { kind: "file", sizeBytes: 4, isSymlink: false, mtimeMs: 0 };
      }
      throw new Error(`ENOENT: ${absolutePath}`);
    },
    async realpath(absolutePath) {
      const relative = toRelative(absolutePath);
      if (relative === null) {
        throw new Error(`ENOENT: ${absolutePath}`);
      }
      const escapeTarget = escapes.get(relative);
      if (escapeTarget) {
        return escapeTarget;
      }
      if (files.has(relative) || directories.has(relative)) {
        return toPhysical(relative);
      }
      throw new Error(`ENOENT: ${absolutePath}`);
    },
    readFile: notImplemented,
    listDirectory: notImplemented,
    writeFile: notImplemented,
    unlink: notImplemented,
    mkdirp: notImplemented,
  };
}

describe("PathContainment.resolveContainedPath", () => {
  it("allows files when logical workspace root aliases to a different realpath", async () => {
    const logicalRoot = path.join(path.sep, "var", "folders", "xx", "T", "ws");
    const physicalRoot = path.join(
      path.sep,
      "private",
      "var",
      "folders",
      "xx",
      "T",
      "ws",
    );
    const fileSystem = createAliasedRootFileSystem({ logicalRoot, physicalRoot });

    const contained = await resolveContainedPath({
      fileSystem,
      workspaceRoot: logicalRoot,
      requestedPath: "app/layout.tsx",
      pathScopes: ["app"],
    });

    expect(contained.relativePath).toBe("app/layout.tsx");
    expect(contained.realPath).toBe(path.join(physicalRoot, "app", "layout.tsx"));
  });

  it("allows creating files under an aliased workspace root", async () => {
    const logicalRoot = path.join(path.sep, "var", "folders", "xx", "T", "ws");
    const physicalRoot = path.join(
      path.sep,
      "private",
      "var",
      "folders",
      "xx",
      "T",
      "ws",
    );
    const fileSystem = createAliasedRootFileSystem({ logicalRoot, physicalRoot });

    const contained = await resolveContainedPath({
      fileSystem,
      workspaceRoot: logicalRoot,
      requestedPath: "app/new.tsx",
      pathScopes: ["app"],
      mustExist: false,
    });

    expect(contained.relativePath).toBe("app/new.tsx");
    expect(contained.absolutePath).toBe(path.join(logicalRoot, "app", "new.tsx"));
  });

  it("still rejects symlink targets that leave the workspace", async () => {
    const logicalRoot = path.join(path.sep, "var", "folders", "xx", "T", "ws");
    const physicalRoot = path.join(
      path.sep,
      "private",
      "var",
      "folders",
      "xx",
      "T",
      "ws",
    );
    const fileSystem = createAliasedRootFileSystem({ logicalRoot, physicalRoot });

    await expect(
      resolveContainedPath({
        fileSystem,
        workspaceRoot: logicalRoot,
        requestedPath: "escape",
        pathScopes: ["."],
      }),
    ).rejects.toMatchObject({
      name: "PathContainmentError",
      reasonCode: "symlink_escape",
    } satisfies Partial<PathContainmentError>);
  });

  it("allows in-workspace files under the host temp directory realpath alias", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mitii-path-containment-"));
    try {
      await mkdir(path.join(root, "app"));
      await writeFile(path.join(root, "app", "layout.tsx"), "export {};\n");
      const physicalRoot = await fsRealpath(root);

      const contained = await resolveContainedPath({
        fileSystem: new NodeWorkspaceFileSystemAdapter(),
        workspaceRoot: root,
        requestedPath: "app/layout.tsx",
        pathScopes: ["app"],
      });
      expect(contained.relativePath).toBe("app/layout.tsx");
      expect(contained.realPath).toBe(path.join(physicalRoot, "app", "layout.tsx"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
