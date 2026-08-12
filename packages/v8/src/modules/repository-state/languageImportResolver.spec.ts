import { describe, expect, it } from "vitest";

import { CodeIndexImportResolver } from "./internal/code-indexing/CodeIndexImportResolver";
import type { WorkspaceSnapshot } from "./internal/workspace/types";

function snapshot(...relativePaths: string[]): WorkspaceSnapshot {
  return {
    schemaVersion: 1,
    snapshotId: "a".repeat(64),
    roots: [
      {
        id: "root",
        name: "root",
        kind: "directory",
      },
    ],
    entries: relativePaths.map((relativePath) => ({
      kind: "file" as const,
      rootId: "root",
      relativePath,
      depth: relativePath.split("/").length,
      size: 32,
    })),
    warnings: [],
    statistics: {
      files: relativePaths.length,
      directories: 0,
      symbolicLinks: 0,
      otherEntries: 0,
      ignoredEntries: 0,
      warnings: 0,
      durationMs: 0,
    },
    limits: {
      maximumDepth: 16,
      maximumFiles: 100,
      maximumDirectories: 100,
      timeoutMs: 1_000,
      followSymbolicLinks: false,
    },
    status: "complete",
    generatedAt: "2026-08-11T00:00:00.000Z",
  };
}

describe("CodeIndexImportResolver in-repo language resolution", () => {
  const resolver = new CodeIndexImportResolver();

  it("still resolves relative TypeScript imports", () => {
    const result = resolver.resolve({
      importerRootId: "root",
      importerRelativePath: "src/service.ts",
      specifier: "./auth",
      language: "typescript",
      snapshot: snapshot("src/auth.ts", "src/service.ts"),
    });
    expect(result).toEqual({
      resolution: "resolved",
      targetRelativePath: "src/auth.ts",
    });
  });

  it("resolves Python dotted in-repo modules to a unique file", () => {
    const result = resolver.resolve({
      importerRootId: "root",
      importerRelativePath: "src/app.py",
      specifier: "auth.session",
      language: "python",
      snapshot: snapshot("src/app.py", "src/auth/session.py"),
    });
    expect(result.resolution).toBe("resolved");
    expect(result.targetRelativePath).toBe("src/auth/session.py");
  });

  it("resolves Go package paths to a representative file in one directory", () => {
    const result = resolver.resolve({
      importerRootId: "root",
      importerRelativePath: "cmd/server/main.go",
      specifier: "example.com/app/internal/auth",
      language: "go",
      snapshot: snapshot(
        "cmd/server/main.go",
        "internal/auth/session.go",
        "internal/auth/token.go",
      ),
    });
    expect(result.resolution).toBe("resolved");
    expect(result.targetRelativePath).toBe("internal/auth/session.go");
  });

  it("resolves TypeScript @/ aliases when the path is unique", () => {
    const result = resolver.resolve({
      importerRootId: "root",
      importerRelativePath: "src/service.ts",
      specifier: "@/auth/session",
      language: "typescript",
      snapshot: snapshot("src/service.ts", "src/auth/session.ts"),
    });
    expect(result.resolution).toBe("resolved");
    expect(result.targetRelativePath).toBe("src/auth/session.ts");
  });

  it("leaves stdlib and third-party specifiers unresolved", () => {
    const python = resolver.resolve({
      importerRootId: "root",
      importerRelativePath: "src/app.py",
      specifier: "os",
      language: "python",
      snapshot: snapshot("src/app.py"),
    });
    const go = resolver.resolve({
      importerRootId: "root",
      importerRelativePath: "main.go",
      specifier: "fmt",
      language: "go",
      snapshot: snapshot("main.go"),
    });
    const npm = resolver.resolve({
      importerRootId: "root",
      importerRelativePath: "src/index.ts",
      specifier: "zod",
      language: "typescript",
      snapshot: snapshot("src/index.ts"),
    });
    expect(python.resolution).toBe("unresolved");
    expect(go.resolution).toBe("unresolved");
    expect(npm.resolution).toBe("unresolved");
  });

  it("does not guess when the same module path exists in two directories", () => {
    const result = resolver.resolve({
      importerRootId: "root",
      importerRelativePath: "src/app.py",
      specifier: "auth.session",
      language: "python",
      snapshot: snapshot(
        "src/app.py",
        "auth/session.py",
        "src/auth/session.py",
      ),
    });
    expect(result.resolution).toBe("unresolved");
  });
});
