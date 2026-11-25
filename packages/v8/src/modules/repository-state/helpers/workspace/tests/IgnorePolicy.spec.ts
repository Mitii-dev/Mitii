import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BoundedWalker,
  InMemoryFileSystemAdapter,
  NodeFileSystemAdapter,
} from "../../shared";
import { WorkspaceScanner } from "../WorkspaceScanner";
import { WorkspaceIgnorePolicy } from "../utils/ws-ignore-policy/WorkspaceIgnorePolicy";
import { isSecurityConcern } from "../utils/ws-ignore-policy/isSecurityConcern";
import {
  parseGitIgnoreLine,
  gitIgnoreRuleMatches,
} from "../utils/ws-ignore-policy/git-ignore/parseGitIgnore";

describe("gitignore glob matching", () => {
  it("matches unanchored globs in any directory", () => {
    const rule = parseGitIgnoreLine("*.log");
    expect(rule).toBeTruthy();
    expect(gitIgnoreRuleMatches(rule!, "debug.log", "file")).toBe(true);
    expect(gitIgnoreRuleMatches(rule!, "src/debug.log", "file")).toBe(true);
    expect(gitIgnoreRuleMatches(rule!, "debug.txt", "file")).toBe(false);
  });

  it("anchors patterns that start with a slash to the ignore file root", () => {
    const rule = parseGitIgnoreLine("/build");
    expect(rule).toBeTruthy();
    expect(gitIgnoreRuleMatches(rule!, "build", "directory")).toBe(true);
    expect(gitIgnoreRuleMatches(rule!, "src/build", "directory")).toBe(false);
  });

  it("treats a trailing slash as directory-only", () => {
    const rule = parseGitIgnoreLine("secret/");
    expect(rule).toBeTruthy();
    expect(gitIgnoreRuleMatches(rule!, "secret", "directory")).toBe(true);
    expect(gitIgnoreRuleMatches(rule!, "secret", "file")).toBe(false);
  });
});

describe("WorkspaceIgnorePolicy defaults and security", () => {
  const policy = new WorkspaceIgnorePolicy();

  it("ignores package manager and Windows build directories anywhere in the path", () => {
    expect(
      policy.shouldIgnore({
        root: "/workspace",
        path: "/workspace/src/node_modules",
        relativePath: "src/node_modules",
        kind: "directory",
        depth: 2,
      }),
    ).toBe(true);
    expect(
      policy.shouldIgnore({
        root: "/workspace",
        path: "/workspace/obj/Debug/App.dll",
        relativePath: "obj/Debug/App.dll",
        kind: "file",
        depth: 3,
      }),
    ).toBe(true);
  });

  it("ignores binary extensions and keeps source files", () => {
    expect(
      policy.shouldIgnore({
        root: "/workspace",
        path: "/workspace/media/logo.png",
        relativePath: "media/logo.png",
        kind: "file",
        depth: 2,
      }),
    ).toBe(true);
    expect(
      policy.shouldIgnore({
        root: "/workspace",
        path: "/workspace/src/LoginForm.cs",
        relativePath: "src/LoginForm.cs",
        kind: "file",
        depth: 2,
      }),
    ).toBe(false);
  });

  it("treats env files, keys, and cloud credential dirs as security concerns", () => {
    expect(isSecurityConcern("src/.env.local")).toBe(true);
    expect(isSecurityConcern("C:\\\\Users\\\\dev\\\\.ssh\\\\id_rsa")).toBe(
      true,
    );
    expect(isSecurityConcern("file:///tmp/appsettings.json")).toBe(false);
    expect(
      policy.evaluateSync({
        root: "/workspace",
        path: "/workspace/.aws/credentials",
        relativePath: ".aws/credentials",
        kind: "file",
        depth: 2,
      }).reason,
    ).toBe("security");
  });
});

describe("nested gitignore and mitiiignore files", () => {
  it("skips files matched by .gitignore and .mitiiignore during a scan", async () => {
    const fileSystem = new InMemoryFileSystemAdapter([
      { kind: "directory", path: "/workspace" },
      { kind: "directory", path: "/workspace/src" },
      {
        kind: "file",
        path: "/workspace/.gitignore",
        content: "ignored.ts\nsecret/\n",
      },
      {
        kind: "file",
        path: "/workspace/.mitiiignore",
        content: "*.generated.ts\n",
      },
      {
        kind: "file",
        path: "/workspace/src/LoginForm.ts",
        content: "export const LoginForm = 1;\n",
      },
      {
        kind: "file",
        path: "/workspace/src/ignored.ts",
        content: "export const skip = 1;\n",
      },
      {
        kind: "file",
        path: "/workspace/src/view.generated.ts",
        content: "export const generated = 1;\n",
      },
      {
        kind: "directory",
        path: "/workspace/secret",
      },
      {
        kind: "file",
        path: "/workspace/secret/token.txt",
        content: "nope\n",
      },
    ]);

    const scanner = new WorkspaceScanner(
      new BoundedWalker(fileSystem),
      new WorkspaceIgnorePolicy({ fileSystem }),
    );
    const snapshot = await scanner.scan({
      roots: ["/workspace"],
      maximumFiles: 100,
    });
    const files = snapshot.entries
      .filter((entry) => entry.kind === "file")
      .map((entry) => entry.relativePath)
      .sort();

    expect(files).toContain("src/LoginForm.ts");
    expect(files).toContain(".gitignore");
    expect(files).not.toContain("src/ignored.ts");
    expect(files).not.toContain("src/view.generated.ts");
    expect(files).not.toContain("secret/token.txt");
  });

  it("loads nested .gitignore from a real workspace root", async () => {
    const root = await mkdtemp(join(tmpdir(), "mitii-ignore-"));
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, ".gitignore"), "tmp/\n", "utf8");
      await mkdir(join(root, "tmp"));
      await writeFile(join(root, "tmp", "cache.txt"), "x\n", "utf8");
      await writeFile(join(root, "src", "app.ts"), "export const n = 1;\n", "utf8");

      const fileSystem = new NodeFileSystemAdapter();
      const scanner = new WorkspaceScanner(
        new BoundedWalker(fileSystem),
        new WorkspaceIgnorePolicy({ fileSystem }),
      );
      const snapshot = await scanner.scan({
        roots: [root],
        maximumFiles: 50,
      });
      const files = snapshot.entries
        .filter((entry) => entry.kind === "file")
        .map((entry) => entry.relativePath);

      expect(files.some((path) => path.endsWith("src/app.ts") || path === "src/app.ts")).toBe(
        true,
      );
      expect(files.some((path) => path.includes("tmp/"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
