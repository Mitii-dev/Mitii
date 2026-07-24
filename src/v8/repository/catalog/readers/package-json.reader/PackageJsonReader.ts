import * as path from "node:path";

import type { FileSystemReadPort } from "../../../shared";
import type { WorkspaceFileEntry } from "../../../workspace";

import type {
  ManifestReader,
  ManifestReaderInput,
  ProjectManifestInfo,
} from "../../types";

export interface PackageJsonReaderOptions {
  /**
   * Maximum package.json size accepted by this reader.
   *
   * Default: 1 MiB
   */
  maximumBytes?: number;
}

interface RawPackageJson {
  name?: unknown;
  version?: unknown;
  private?: unknown;
  type?: unknown;

  main?: unknown;
  module?: unknown;
  browser?: unknown;
  types?: unknown;
  typings?: unknown;

  bin?: unknown;
  scripts?: unknown;

  dependencies?: unknown;
  devDependencies?: unknown;
  peerDependencies?: unknown;
  optionalDependencies?: unknown;

  workspaces?: unknown;

  engines?: unknown;
  packageManager?: unknown;

  keywords?: unknown;

  repository?: unknown;

  vscode?: unknown;
}

const DEFAULT_MAXIMUM_BYTES = 1024 * 1024;

const COMMON_ENTRY_FILES = [
  "src/index.ts",
  "src/index.tsx",
  "src/index.js",
  "src/index.jsx",
  "src/main.ts",
  "src/main.tsx",
  "src/main.js",
  "src/main.jsx",
  "src/server.ts",
  "src/server.js",
  "src/app.ts",
  "src/app.tsx",
  "src/app.js",
  "src/app.jsx",
  "index.ts",
  "index.tsx",
  "index.js",
  "index.jsx",
  "server.ts",
  "server.js",
  "app.ts",
  "app.tsx",
  "app.js",
  "app.jsx",
] as const;

const COMMON_SOURCE_ROOTS = [
  "src",
  "app",
  "lib",
  "server",
  "client",
  "packages",
] as const;

const COMMON_TEST_ROOTS = [
  "test",
  "tests",
  "__tests__",
  "spec",
  "e2e",
  "cypress",
  "playwright",
] as const;

export class PackageJsonReader implements ManifestReader {
  public readonly id = "package-json";

  public readonly priority = 100;

  private readonly maximumBytes: number;

  constructor(
    private readonly fileSystem: FileSystemReadPort,
    options: PackageJsonReaderOptions = {},
  ) {
    this.maximumBytes = options.maximumBytes ?? DEFAULT_MAXIMUM_BYTES;

    this.validateMaximumBytes(this.maximumBytes);
  }

  public supports(manifest: WorkspaceFileEntry): boolean {
    return (
      path.posix
        .basename(this.normalizeRelativePath(manifest.relativePath))
        .toLowerCase() === "package.json"
    );
  }

  public async read(input: ManifestReaderInput): Promise<ProjectManifestInfo> {
    if (!this.supports(input.manifest)) {
      throw new Error(
        `PackageJsonReader does not support manifest ` +
          `"${input.manifest.relativePath}".`,
      );
    }

    const providerPath = input.manifest.providerPath;

    if (!providerPath) {
      throw new Error(
        `Cannot read package manifest ` +
          `"${input.manifest.relativePath}" because it has no ` +
          "providerPath.",
      );
    }

    const content = await this.fileSystem.readText(providerPath, {
      encoding: "utf8",
      maximumBytes: this.maximumBytes,
    });

    const manifest = this.parseManifest(content, input.manifest.relativePath);

    const scripts = this.readStringRecord(manifest.scripts);

    const dependencies = this.mergeDependencyNames(
      manifest.dependencies,
      manifest.peerDependencies,
      manifest.optionalDependencies,
    );

    const developmentDependencies = this.readDependencyNames(
      manifest.devDependencies,
    );

    const projectEntryPaths = this.collectProjectEntryPaths(
      input.projectEntries,
      input.relativeRoot,
    );

    const declaredEntryFiles = this.extractDeclaredEntryFiles(manifest);

    const suggestedEntryFiles = this.resolveSuggestedEntryFiles(
      declaredEntryFiles,
      projectEntryPaths,
    );

    const suggestedSourceRoots = this.detectExistingRoots(
      projectEntryPaths,
      COMMON_SOURCE_ROOTS,
    );

    const suggestedTestRoots = this.detectExistingRoots(
      projectEntryPaths,
      COMMON_TEST_ROOTS,
    );

    return {
      readerId: this.id,
      ecosystem: "node",

      relativeRoot: input.relativeRoot,

      manifestPaths: [this.normalizeRelativePath(input.manifest.relativePath)],

      ...this.optionalStringProperty("declaredName", manifest.name),

      ...this.optionalStringProperty("declaredVersion", manifest.version),

      scripts,

      dependencies,
      developmentDependencies,

      suggestedEntryFiles,
      suggestedSourceRoots,
      suggestedTestRoots,
    };
  }

  private parseManifest(content: string, relativePath: string): RawPackageJson {
    let parsed: unknown;

    try {
      parsed = JSON.parse(content);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      throw new Error(`Invalid JSON in "${relativePath}": ${message}`);
    }

    if (!this.isRecord(parsed)) {
      throw new Error(
        `Package manifest "${relativePath}" must contain ` + "a JSON object.",
      );
    }

    return parsed;
  }

  private extractDeclaredEntryFiles(manifest: RawPackageJson): string[] {
    const entries: string[] = [];

    this.addStringValue(entries, manifest.main);
    this.addStringValue(entries, manifest.module);
    this.addStringValue(entries, manifest.types);
    this.addStringValue(entries, manifest.typings);

    if (typeof manifest.browser === "string") {
      entries.push(manifest.browser);
    }

    if (typeof manifest.bin === "string") {
      entries.push(manifest.bin);
    } else if (this.isRecord(manifest.bin)) {
      for (const value of Object.values(manifest.bin)) {
        this.addStringValue(entries, value);
      }
    }

    return this.normalizeUniquePaths(entries);
  }

  private resolveSuggestedEntryFiles(
    declaredEntries: readonly string[],
    projectEntryPaths: ReadonlySet<string>,
  ): string[] {
    const suggestions: string[] = [];

    /*
     * Explicit manifest declarations are retained even if the
     * referenced output has not been generated yet.
     *
     * Example: package.json may declare dist/index.js while dist
     * is ignored by WorkspaceIgnorePolicy.
     */
    suggestions.push(...declaredEntries);

    for (const candidate of COMMON_ENTRY_FILES) {
      if (projectEntryPaths.has(candidate)) {
        suggestions.push(candidate);
      }
    }

    return this.normalizeUniquePaths(suggestions);
  }

  private collectProjectEntryPaths(
    entries: readonly WorkspaceFileEntry[],
    relativeRoot: string,
  ): ReadonlySet<string> {
    const paths = new Set<string>();
    const normalizedRoot = this.normalizeProjectRoot(relativeRoot);

    for (const entry of entries) {
      const relativePath = this.normalizeRelativePath(entry.relativePath);

      const projectRelativePath = this.relativeToProjectRoot(
        relativePath,
        normalizedRoot,
      );

      if (projectRelativePath !== null) {
        paths.add(projectRelativePath);
      }
    }

    return paths;
  }

  private relativeToProjectRoot(
    entryPath: string,
    projectRoot: string,
  ): string | null {
    if (!projectRoot) {
      return entryPath;
    }

    if (entryPath === projectRoot) {
      return "";
    }

    const prefix = `${projectRoot}/`;

    if (!entryPath.startsWith(prefix)) {
      return null;
    }

    return entryPath.slice(prefix.length);
  }

  private detectExistingRoots(
    projectEntryPaths: ReadonlySet<string>,
    candidates: readonly string[],
  ): string[] {
    const roots: string[] = [];

    for (const candidate of candidates) {
      const prefix = `${candidate}/`;

      const exists = [...projectEntryPaths].some(
        (entryPath) => entryPath === candidate || entryPath.startsWith(prefix),
      );

      if (exists) {
        roots.push(candidate);
      }
    }

    return roots.sort((left, right) => left.localeCompare(right));
  }

  private mergeDependencyNames(...values: unknown[]): string[] {
    const dependencies = new Set<string>();

    for (const value of values) {
      for (const name of this.readDependencyNames(value)) {
        dependencies.add(name);
      }
    }

    return [...dependencies].sort((left, right) => left.localeCompare(right));
  }

  private readDependencyNames(value: unknown): string[] {
    if (!this.isRecord(value)) {
      return [];
    }

    return Object.entries(value)
      .filter(
        ([name, version]) =>
          name.trim().length > 0 && typeof version === "string",
      )
      .map(([name]) => name)
      .sort((left, right) => left.localeCompare(right));
  }

  private readStringRecord(value: unknown): Record<string, string> {
    if (!this.isRecord(value)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([name, command]) =>
            name.trim().length > 0 && typeof command === "string",
        )
        .sort(([left], [right]) => left.localeCompare(right)),
    ) as Record<string, string>;
  }

  private addStringValue(target: string[], value: unknown): void {
    if (typeof value === "string" && value.trim()) {
      target.push(value);
    }
  }

  private optionalStringProperty<TKey extends string>(
    key: TKey,
    value: unknown,
  ): Partial<Record<TKey, string>> {
    if (typeof value !== "string" || !value.trim()) {
      return {};
    }

    return {
      [key]: value.trim(),
    } as Partial<Record<TKey, string>>;
  }

  private normalizeUniquePaths(values: readonly string[]): string[] {
    const normalized = values
      .map((value) => this.normalizeRelativePath(value))
      .filter(Boolean);

    return [...new Set(normalized)].sort((left, right) =>
      left.localeCompare(right),
    );
  }

  private normalizeProjectRoot(value: string): string {
    const normalized = this.normalizeRelativePath(value);

    return normalized === "." ? "" : normalized;
  }

  private normalizeRelativePath(value: string): string {
    const normalized = value
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\.\/+/, "");

    const result = path.posix.normalize(normalized);

    if (result === ".") {
      return "";
    }

    return result.replace(/^\/+/, "");
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private validateMaximumBytes(maximumBytes: number): void {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
      throw new RangeError("maximumBytes must be a positive safe integer.");
    }
  }
}
