import { describe, expect, it } from "vitest";

import { InMemoryFileSystemAdapter } from "../../shared";
import type { WorkspaceFileEntry, WorkspaceSnapshot } from "../../workspace";
import { createDefaultProjectCatalogBuilder } from "../DefaultProjectCatalogBuilder";
import type { ManifestReader } from "../types";
import { CargoTomlReader } from "./cargo-toml.reader";
import { ComposerJsonReader } from "./composer-json.reader";
import { DotnetProjectReader } from "./dotnet-project.reader";
import { GemfileReader } from "./gemfile.reader";
import { PyprojectReader } from "./pyproject-reader";

const SNAPSHOT_ID =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("catalog manifest readers", () => {
  it("reads Cargo package manifests", async () => {
    const { reader, manifest, entries } = createReaderFixture(
      new CargoTomlReader(
        createFileSystem({
          "crates/api/Cargo.toml": `
[package]
name = "mitii-api"
version = "0.1.0"

[dependencies]
serde = "1"

[dev-dependencies]
insta = "1"
`,
          "crates/api/src/lib.rs": "",
          "crates/api/tests/smoke.rs": "",
        }),
      ),
      "crates/api/Cargo.toml",
      ["crates/api/src/lib.rs", "crates/api/tests/smoke.rs"],
    );

    const info = await reader.read({
      rootId: "workspace",
      relativeRoot: "crates/api",
      manifest,
      projectEntries: entries,
    });

    expect(info).toMatchObject({
      ecosystem: "rust",
      declaredName: "mitii-api",
      declaredVersion: "0.1.0",
      scripts: {
        build: "cargo build",
        check: "cargo check",
        test: "cargo test",
      },
      dependencies: ["serde"],
      developmentDependencies: ["insta"],
      suggestedEntryFiles: ["src/lib.rs"],
      suggestedSourceRoots: ["src"],
      suggestedTestRoots: ["tests"],
    });
  });

  it("reads workspace-only Cargo manifests without package metadata", async () => {
    const { reader, manifest } = createReaderFixture(
      new CargoTomlReader(
        createFileSystem({
          "Cargo.toml": `
[workspace]
members = ["crates/api"]
resolver = "2"
`,
        }),
      ),
      "Cargo.toml",
      [],
    );

    const info = await reader.read({
      rootId: "workspace",
      relativeRoot: "",
      manifest,
      projectEntries: [manifest],
    });

    expect(info.ecosystem).toBe("rust");
    expect(info.declaredName).toBeUndefined();
    expect(info.dependencies).toEqual([]);
    expect(info.scripts.test).toBe("cargo test");
  });

  it("reads PEP 621 pyproject manifests", async () => {
    const { reader, manifest, entries } = createReaderFixture(
      new PyprojectReader(
        createFileSystem({
          "services/worker/pyproject.toml": `
[project]
name = "mitii-worker"
version = "2.0.0"
dependencies = ["requests>=2", "pydantic[email]"]

[project.optional-dependencies]
test = ["pytest", "ruff"]
`,
          "services/worker/src/mitii_worker/__init__.py": "",
          "services/worker/tests/test_worker.py": "",
        }),
      ),
      "services/worker/pyproject.toml",
      [
        "services/worker/src/mitii_worker/__init__.py",
        "services/worker/tests/test_worker.py",
      ],
    );

    const info = await reader.read({
      rootId: "workspace",
      relativeRoot: "services/worker",
      manifest,
      projectEntries: entries,
    });

    expect(info).toMatchObject({
      ecosystem: "python",
      declaredName: "mitii-worker",
      declaredVersion: "2.0.0",
      dependencies: ["pydantic", "requests"],
      developmentDependencies: ["pytest", "ruff"],
      suggestedEntryFiles: ["src/mitii_worker/__init__.py"],
      suggestedSourceRoots: ["src", "src/mitii_worker"],
      suggestedTestRoots: ["tests"],
    });
  });

  it("reads Composer manifests", async () => {
    const { reader, manifest, entries } = createReaderFixture(
      new ComposerJsonReader(
        createFileSystem({
          "php/composer.json": JSON.stringify({
            name: "mitii/api",
            version: "1.4.0",
            require: {
              php: "^8.3",
              "ext-json": "*",
              "symfony/console": "^7.0",
            },
            "require-dev": {
              "phpunit/phpunit": "^11.0",
            },
            scripts: {
              test: "phpunit",
              lint: ["phpstan analyse", "phpcs"],
            },
            autoload: {
              "psr-4": {
                "Mitii\\Api\\": "src/",
              },
            },
            "autoload-dev": {
              "psr-4": {
                "Mitii\\Api\\Tests\\": "tests/",
              },
            },
            bin: ["bin/console"],
          }),
          "php/src/App.php": "",
          "php/tests/AppTest.php": "",
          "php/bin/console": "",
        }),
      ),
      "php/composer.json",
      ["php/src/App.php", "php/tests/AppTest.php", "php/bin/console"],
    );

    const info = await reader.read({
      rootId: "workspace",
      relativeRoot: "php",
      manifest,
      projectEntries: entries,
    });

    expect(info).toMatchObject({
      ecosystem: "php",
      declaredName: "mitii/api",
      declaredVersion: "1.4.0",
      dependencies: ["symfony/console"],
      developmentDependencies: ["phpunit/phpunit"],
      scripts: {
        lint: "phpstan analyse && phpcs",
        test: "phpunit",
      },
      suggestedEntryFiles: ["bin/console"],
      suggestedSourceRoots: ["src"],
      suggestedTestRoots: ["tests"],
    });
  });

  it("reads Gemfile manifests", async () => {
    const { reader, manifest, entries } = createReaderFixture(
      new GemfileReader(
        createFileSystem({
          "ruby/Gemfile": `
source "https://rubygems.org"

gem "rails"
gem "pg", group: :production

group :development, :test do
  gem "rspec-rails"
end
`,
          "ruby/mitii-ruby.gemspec": "",
          "ruby/app/models/user.rb": "",
          "ruby/lib/mitii-ruby.rb": "",
          "ruby/spec/user_spec.rb": "",
        }),
      ),
      "ruby/Gemfile",
      [
        "ruby/mitii-ruby.gemspec",
        "ruby/app/models/user.rb",
        "ruby/lib/mitii-ruby.rb",
        "ruby/spec/user_spec.rb",
      ],
    );

    const info = await reader.read({
      rootId: "workspace",
      relativeRoot: "ruby",
      manifest,
      projectEntries: entries,
    });

    expect(info).toMatchObject({
      ecosystem: "ruby",
      declaredName: "mitii-ruby",
      dependencies: ["pg", "rails"],
      developmentDependencies: ["rspec-rails"],
      suggestedEntryFiles: ["lib/mitii-ruby.rb"],
      suggestedSourceRoots: ["app", "lib"],
      suggestedTestRoots: ["spec"],
    });
  });

  it("reads .NET project manifests", async () => {
    const { reader, manifest, entries } = createReaderFixture(
      new DotnetProjectReader(
        createFileSystem({
          "dotnet/App.csproj": `
<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <AssemblyName>Mitii.App</AssemblyName>
    <Version>3.2.1</Version>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Serilog" Version="4.0.0" />
    <PackageReference Include="xunit" Version="2.9.0" PrivateAssets="all" />
  </ItemGroup>
</Project>
`,
          "dotnet/Program.cs": "",
          "dotnet/Controllers/HomeController.cs": "",
          "dotnet/Tests/AppTests.cs": "",
        }),
      ),
      "dotnet/App.csproj",
      [
        "dotnet/Program.cs",
        "dotnet/Controllers/HomeController.cs",
        "dotnet/Tests/AppTests.cs",
      ],
    );

    const info = await reader.read({
      rootId: "workspace",
      relativeRoot: "dotnet",
      manifest,
      projectEntries: entries,
    });

    expect(info).toMatchObject({
      ecosystem: "dotnet",
      declaredName: "Mitii.App",
      declaredVersion: "3.2.1",
      dependencies: ["Serilog"],
      developmentDependencies: ["xunit"],
      suggestedEntryFiles: ["Program.cs"],
      suggestedSourceRoots: ["Controllers"],
      suggestedTestRoots: ["Tests"],
    });
  });

  it("registers all catalog readers in the default builder", async () => {
    const files = {
      "rust/Cargo.toml": `
[package]
name = "rust-api"
version = "0.1.0"
`,
      "rust/src/lib.rs": "",
      "python/pyproject.toml": `
[project]
name = "python-worker"
version = "1.0.0"
`,
      "python/src/python_worker/__init__.py": "",
      "php/composer.json": JSON.stringify({
        name: "mitii/php-api",
        require: {
          "symfony/http-foundation": "^7.0",
        },
      }),
      "php/src/App.php": "",
      "ruby/Gemfile": 'source "https://rubygems.org"\ngem "sinatra"\n',
      "ruby/ruby.gemspec": "",
      "ruby/lib/app.rb": "",
      "dotnet/App.csproj": `
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <AssemblyName>DotnetApp</AssemblyName>
  </PropertyGroup>
</Project>
`,
      "dotnet/Program.cs": "",
    } satisfies Record<string, string>;

    const catalog = await createDefaultProjectCatalogBuilder(
      createFileSystem(files),
    ).build({
      snapshot: createSnapshot(Object.keys(files)),
    });

    expect(catalog.status).toBe("complete");
    expect(catalog.warnings).toEqual([]);
    expect(
      catalog.projects.map((project) => [
        project.relativeRoot,
        project.ecosystems[0],
        project.name,
      ]),
    ).toEqual([
      ["dotnet", "dotnet", "DotnetApp"],
      ["php", "php", "mitii/php-api"],
      ["python", "python", "python-worker"],
      ["ruby", "ruby", "ruby"],
      ["rust", "rust", "rust-api"],
    ]);

    const rust = catalog.projects.find((project) => project.name === "rust-api");
    const python = catalog.projects.find(
      (project) => project.name === "python-worker",
    );

    expect(rust?.scripts).toMatchObject({
      check: "cargo check",
      test: "cargo test",
    });
    expect(python?.scripts).toMatchObject({
      build: "python -m build",
      test: "pytest",
    });
  });
});

function createReaderFixture(
  reader: ManifestReader,
  manifestPath: string,
  projectEntryPaths: readonly string[],
): {
  reader: ManifestReader;
  manifest: WorkspaceFileEntry;
  entries: WorkspaceFileEntry[];
} {
  const manifest = createFileEntry(manifestPath);

  return {
    reader,
    manifest,
    entries: [
      manifest,
      ...projectEntryPaths.map((entryPath) => createFileEntry(entryPath)),
    ],
  };
}

function createFileSystem(files: Record<string, string>): InMemoryFileSystemAdapter {
  return new InMemoryFileSystemAdapter(
    Object.entries(files).map(([relativePath, content]) => ({
      kind: "file",
      path: providerPath(relativePath),
      content,
    })),
  );
}

function createSnapshot(relativePaths: readonly string[]): WorkspaceSnapshot {
  return {
    schemaVersion: 1,
    snapshotId: SNAPSHOT_ID,
    roots: [
      {
        id: "workspace",
        name: "workspace",
        providerPath: "/workspace",
        kind: "directory",
      },
    ],
    entries: relativePaths.map((relativePath) => createFileEntry(relativePath)),
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
      maximumDepth: 100,
      maximumFiles: 1000,
      maximumDirectories: 1000,
      timeoutMs: 1000,
      followSymbolicLinks: false,
    },
    status: "complete",
    generatedAt: "2026-08-11T00:00:00.000Z",
  };
}

function createFileEntry(relativePath: string): WorkspaceFileEntry {
  return {
    kind: "file",
    rootId: "workspace",
    relativePath,
    providerPath: providerPath(relativePath),
    depth: relativePath.split("/").length,
  };
}

function providerPath(relativePath: string): string {
  return `/workspace/${relativePath}`;
}
