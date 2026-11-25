import * as path from "node:path";
import { parse as parseToml } from "smol-toml";

import type { FileSystemReadPort } from "../../../shared";
import type { WorkspaceFileEntry } from "../../../workspace";
import type {
  ManifestReader,
  ManifestReaderInput,
  ProjectManifestInfo,
} from "../../types";

export interface CargoTomlReaderOptions {
  /**
   * Maximum Cargo.toml size accepted by this reader.
   *
   * Default: 1 MiB
   */
  maximumBytes?: number;
}

interface RawCargoToml {
  package?: unknown;
  workspace?: unknown;
  dependencies?: unknown;
  "dev-dependencies"?: unknown;
  "build-dependencies"?: unknown;
  target?: unknown;
  lib?: unknown;
  bin?: unknown;
}

const DEFAULT_MAXIMUM_BYTES = 1024 * 1024;

const COMMON_ENTRY_FILES = ["src/main.rs", "src/lib.rs"] as const;
const COMMON_SOURCE_ROOTS = ["src", "crates"] as const;
const COMMON_TEST_ROOTS = ["tests"] as const;

export class CargoTomlReader implements ManifestReader {
  public readonly id = "cargo-toml";

  public readonly priority = 10;

  private readonly maximumBytes: number;

  constructor(
    private readonly fileSystem: FileSystemReadPort,
    options: CargoTomlReaderOptions = {},
  ) {
    this.maximumBytes = options.maximumBytes ?? DEFAULT_MAXIMUM_BYTES;

    this.validateMaximumBytes(this.maximumBytes);
  }

  public supports(manifest: WorkspaceFileEntry): boolean {
    return (
      path.posix
        .basename(this.normalizeRelativePath(manifest.relativePath))
        .toLowerCase() === "cargo.toml"
    );
  }

  public async read(input: ManifestReaderInput): Promise<ProjectManifestInfo> {
    if (!this.supports(input.manifest)) {
      throw new Error(
        `CargoTomlReader does not support "${input.manifest.relativePath}".`,
      );
    }

    const providerPath = input.manifest.providerPath;

    if (!providerPath) {
      throw new Error(
        `Cannot read Cargo manifest "${input.manifest.relativePath}" ` +
          "because providerPath is missing.",
      );
    }

    const content = await this.fileSystem.readText(providerPath, {
      encoding: "utf8",
      maximumBytes: this.maximumBytes,
    });

    const manifest = this.parseManifest(content, input.manifest.relativePath);
    const packageSection = this.asRecord(manifest.package);

    const projectEntryPaths = this.collectProjectEntryPaths(
      input.projectEntries,
      input.relativeRoot,
    );

    const declaredEntryFiles = this.extractDeclaredEntryFiles(manifest);

    return {
      readerId: this.id,
      ecosystem: "rust",

      relativeRoot: this.normalizeProjectRoot(input.relativeRoot),

      manifestPaths: [this.normalizeRelativePath(input.manifest.relativePath)],

      ...this.optionalStringProperty(
        "declaredName",
        packageSection?.name,
      ),

      ...this.optionalStringProperty(
        "declaredVersion",
        packageSection?.version,
      ),

      scripts: {
        build: "cargo build",
        check: "cargo check",
        test: "cargo test",
      },

      dependencies: this.uniqueStrings([
        ...this.readDependencyNames(manifest.dependencies),
        ...this.readDependencyNames(manifest["build-dependencies"]),
        ...this.readTargetDependencyNames(manifest.target, "dependencies"),
        ...this.readTargetDependencyNames(
          manifest.target,
          "build-dependencies",
        ),
      ]),

      developmentDependencies: this.uniqueStrings([
        ...this.readDependencyNames(manifest["dev-dependencies"]),
        ...this.readTargetDependencyNames(manifest.target, "dev-dependencies"),
      ]),

      suggestedEntryFiles: this.resolveSuggestedEntryFiles(
        declaredEntryFiles,
        projectEntryPaths,
      ),
      suggestedSourceRoots: this.detectExistingRoots(
        projectEntryPaths,
        COMMON_SOURCE_ROOTS,
      ),
      suggestedTestRoots: this.detectExistingRoots(
        projectEntryPaths,
        COMMON_TEST_ROOTS,
      ),
    };
  }

  private parseManifest(content: string, relativePath: string): RawCargoToml {
    let parsed: unknown;

    try {
      parsed = parseToml(content);
    } catch (error) {
      throw new Error(
        `Invalid TOML in "${relativePath}": ${this.errorMessage(error)}`,
      );
    }

    if (!this.isRecord(parsed)) {
      throw new Error(
        `Cargo manifest "${relativePath}" must contain a TOML table.`,
      );
    }

    return parsed as RawCargoToml;
  }

  private extractDeclaredEntryFiles(manifest: RawCargoToml): string[] {
    const entries: string[] = [];
    const lib = this.asRecord(manifest.lib);

    this.addStringValue(entries, lib?.path);

    for (const bin of this.toArray(manifest.bin)) {
      const record = this.asRecord(bin);

      this.addStringValue(entries, record?.path);
    }

    return this.normalizeUniquePaths(entries);
  }

  private resolveSuggestedEntryFiles(
    declaredEntries: readonly string[],
    projectEntryPaths: ReadonlySet<string>,
  ): string[] {
    const suggestions = [...declaredEntries];

    for (const candidate of COMMON_ENTRY_FILES) {
      if (projectEntryPaths.has(candidate)) {
        suggestions.push(candidate);
      }
    }

    return this.normalizeUniquePaths(suggestions);
  }

  private readDependencyNames(value: unknown): string[] {
    const record = this.asRecord(value);

    if (!record) {
      return [];
    }

    return Object.keys(record)
      .map((name) => name.trim())
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));
  }

  private readTargetDependencyNames(
    value: unknown,
    dependencySectionName: string,
  ): string[] {
    const names: string[] = [];
    const target = this.asRecord(value);

    if (!target) {
      return names;
    }

    for (const targetConfig of Object.values(target)) {
      const targetRecord = this.asRecord(targetConfig);

      if (!targetRecord) {
        continue;
      }

      names.push(...this.readDependencyNames(targetRecord[dependencySectionName]));
    }

    return names;
  }

  private collectProjectEntryPaths(
    entries: readonly WorkspaceFileEntry[],
    relativeRoot: string,
  ): ReadonlySet<string> {
    const paths = new Set<string>();
    const normalizedRoot = this.normalizeProjectRoot(relativeRoot);

    for (const entry of entries) {
      const entryPath = this.normalizeRelativePath(entry.relativePath);
      const projectRelativePath = this.relativeToProjectRoot(
        entryPath,
        normalizedRoot,
      );

      if (projectRelativePath !== null && projectRelativePath !== "") {
        paths.add(projectRelativePath);
      }
    }

    return paths;
  }

  private detectExistingRoots(
    projectEntryPaths: ReadonlySet<string>,
    candidates: readonly string[],
  ): string[] {
    const roots = new Set<string>();

    for (const candidate of candidates) {
      const prefix = `${candidate}/`;

      const exists = [...projectEntryPaths].some(
        (entryPath) => entryPath === candidate || entryPath.startsWith(prefix),
      );

      if (exists) {
        roots.add(candidate);
      }
    }

    return [...roots].sort((left, right) => left.localeCompare(right));
  }

  private normalizeUniquePaths(values: readonly string[]): string[] {
    const normalized = values
      .map((value) => this.normalizeRelativePath(value))
      .filter(Boolean);

    return [...new Set(normalized)].sort((left, right) =>
      left.localeCompare(right),
    );
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

  private uniqueStrings(values: readonly string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(
      (left, right) => left.localeCompare(right),
    );
  }

  private toArray(value: unknown): readonly unknown[] {
    if (value === undefined) {
      return [];
    }

    return Array.isArray(value) ? value : [value];
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return this.isRecord(value) ? value : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
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

    return entryPath.startsWith(prefix)
      ? entryPath.slice(prefix.length)
      : null;
  }

  private validateMaximumBytes(maximumBytes: number): void {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
      throw new RangeError("maximumBytes must be a positive safe integer.");
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
