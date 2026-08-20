import { describe, expect, it } from "vitest";

import type { ProjectDescriptor } from "../../repository-state";

import { InMemoryManifestReader } from "..";
import { discoverCandidatesForProject } from "../internal/discovery";

function project(
  partial: Partial<ProjectDescriptor> &
    Pick<ProjectDescriptor, "projectId" | "primaryLanguageId">,
): ProjectDescriptor {
  return {
    rootPath: ".",
    manifestPaths: [],
    ...partial,
  };
}

describe("verification language discovery", () => {
  it("discovers TypeScript package.json scripts only when present", async () => {
    const manifests = new InMemoryManifestReader({
      "package.json": JSON.stringify({
        scripts: { typecheck: "tsc -p .", lint: "eslint ." },
      }),
    });

    const result = await discoverCandidatesForProject({
      project: project({
        projectId: "ts",
        primaryLanguageId: "typescript",
      }),
      changedFiles: ["src/a.ts"],
      manifests,
    });

    expect(result.candidates.map((c) => c.kind).sort()).toEqual([
      "lint",
      "typecheck",
    ]);
    expect(result.candidates.every((c) => c.argv && c.argv[0] === "npm")).toBe(
      true,
    );
  });

  it("discovers desktop:test and falls back to tsc when scripts omit typecheck", async () => {
    const result = await discoverCandidatesForProject({
      project: project({
        projectId: "workspace-root",
        primaryLanguageId: "typescript",
      }),
      changedFiles: ["test/specs/a.spec.ts"],
      manifests: new InMemoryManifestReader({
        "package.json": JSON.stringify({
          scripts: {
            "desktop:test": "wdio run ./wdio.desktop.conf.ts",
          },
        }),
        "tsconfig.json": "{ \"compilerOptions\": { \"strict\": true } }",
      }),
    });

    expect(result.candidates.map((c) => c.kind).sort()).toEqual([
      "test",
      "typecheck",
    ]);
    expect(
      result.candidates.find((c) => c.kind === "test")?.argv,
    ).toEqual(["npm", "run", "desktop:test"]);
    expect(
      result.candidates.find((c) => c.kind === "typecheck")?.argv,
    ).toEqual(["npx", "tsc", "--noEmit"]);
  });

  it("discovers Python pytest/mypy/ruff from pyproject evidence", async () => {
    const manifests = new InMemoryManifestReader({
      "pyproject.toml": `
[tool.pytest.ini_options]
testpaths = ["tests"]
[tool.mypy]
strict = true
[tool.ruff]
line-length = 100
`,
    });

    const result = await discoverCandidatesForProject({
      project: project({ projectId: "py", primaryLanguageId: "python" }),
      changedFiles: ["app.py"],
      manifests,
    });

    expect(result.candidates.map((c) => c.kind).sort()).toEqual([
      "lint",
      "test",
      "typecheck",
    ]);
  });

  it("discovers Go checks only with go.mod", async () => {
    const missing = await discoverCandidatesForProject({
      project: project({ projectId: "go", primaryLanguageId: "go" }),
      changedFiles: ["main.go"],
      manifests: new InMemoryManifestReader(),
    });
    expect(missing.candidates).toEqual([]);
    expect(missing.warnings[0]).toMatch(/go\.mod/);

    const present = await discoverCandidatesForProject({
      project: project({ projectId: "go", primaryLanguageId: "go" }),
      changedFiles: ["main.go"],
      manifests: new InMemoryManifestReader({ "go.mod": "module example" }),
    });
    expect(present.candidates.some((c) => c.kind === "test")).toBe(true);
  });

  it("discovers Rust cargo checks from Cargo.toml", async () => {
    const result = await discoverCandidatesForProject({
      project: project({ projectId: "rs", primaryLanguageId: "rust" }),
      changedFiles: ["src/lib.rs"],
      manifests: new InMemoryManifestReader({
        "Cargo.toml": '[package]\nname = "demo"',
      }),
    });
    expect(result.candidates.map((c) => c.kind).sort()).toEqual([
      "lint",
      "test",
      "typecheck",
    ]);
  });

  it("discovers Java maven and Kotlin gradle evidence", async () => {
    const java = await discoverCandidatesForProject({
      project: project({ projectId: "java", primaryLanguageId: "java" }),
      changedFiles: ["src/Main.java"],
      manifests: new InMemoryManifestReader({ "pom.xml": "<project />" }),
    });
    expect(java.candidates.some((c) => c.argv?.[0] === "mvn")).toBe(true);

    const kotlin = await discoverCandidatesForProject({
      project: project({ projectId: "kt", primaryLanguageId: "kotlin" }),
      changedFiles: ["src/Main.kt"],
      manifests: new InMemoryManifestReader({
        "build.gradle.kts": "plugins {}",
        gradlew: "#!/bin/sh",
      }),
    });
    expect(kotlin.candidates.some((c) => c.argv?.[0] === "./gradlew")).toBe(
      true,
    );
  });

  it("discovers C# from Directory.Build.props", async () => {
    const result = await discoverCandidatesForProject({
      project: project({ projectId: "cs", primaryLanguageId: "csharp" }),
      changedFiles: ["Program.cs"],
      manifests: new InMemoryManifestReader({
        "Directory.Build.props": "<Project />",
      }),
    });
    expect(result.candidates.some((c) => c.argv?.[0] === "dotnet")).toBe(true);
  });

  it("discovers C/C++ from CMakeLists or Makefile", async () => {
    const cmake = await discoverCandidatesForProject({
      project: project({ projectId: "c", primaryLanguageId: "c" }),
      changedFiles: ["main.c"],
      manifests: new InMemoryManifestReader({
        "CMakeLists.txt": "project(demo)",
      }),
    });
    expect(cmake.candidates.some((c) => c.argv?.[0] === "cmake")).toBe(true);

    const make = await discoverCandidatesForProject({
      project: project({ projectId: "cpp", primaryLanguageId: "cpp" }),
      changedFiles: ["main.cpp"],
      manifests: new InMemoryManifestReader({ Makefile: "all:\n\t@echo hi" }),
    });
    expect(make.candidates.some((c) => c.argv?.[0] === "make")).toBe(true);
  });

  it("discovers Ruby/PHP/Swift from ecosystem manifests", async () => {
    const ruby = await discoverCandidatesForProject({
      project: project({ projectId: "rb", primaryLanguageId: "ruby" }),
      changedFiles: ["app.rb"],
      manifests: new InMemoryManifestReader({ Gemfile: 'source "https://rubygems.org"' }),
    });
    expect(ruby.candidates[0]?.argv?.[0]).toBe("bundle");

    const php = await discoverCandidatesForProject({
      project: project({ projectId: "php", primaryLanguageId: "php" }),
      changedFiles: ["index.php"],
      manifests: new InMemoryManifestReader({
        "composer.json": JSON.stringify({ scripts: { test: "phpunit" } }),
      }),
    });
    expect(php.candidates[0]?.argv).toEqual(["composer", "test"]);

    const swift = await discoverCandidatesForProject({
      project: project({ projectId: "swift", primaryLanguageId: "swift" }),
      changedFiles: ["Sources/App.swift"],
      manifests: new InMemoryManifestReader({
        "Package.swift": "// swift-tools-version: 5.9",
      }),
    });
    expect(swift.candidates.some((c) => c.argv?.[0] === "swift")).toBe(true);
  });

  it("does not invent shell/sql checks without evidence", async () => {
    const shell = await discoverCandidatesForProject({
      project: project({ projectId: "sh", primaryLanguageId: "shell" }),
      changedFiles: ["scripts/run.sh"],
      manifests: new InMemoryManifestReader(),
    });
    expect(shell.candidates).toEqual([]);
    expect(shell.warnings[0]).toMatch(/not invented|unavailable/i);

    const sql = await discoverCandidatesForProject({
      project: project({ projectId: "sql", primaryLanguageId: "sql" }),
      changedFiles: ["schema.sql"],
      manifests: new InMemoryManifestReader(),
    });
    expect(sql.candidates).toEqual([]);
    expect(sql.warnings[0]).toMatch(/unavailable/);
  });
});
