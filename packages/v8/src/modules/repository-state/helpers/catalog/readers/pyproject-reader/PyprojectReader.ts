import * as path from "node:path";
import { parse as parseToml } from "smol-toml";

import type { FileSystemReadPort } from "../../../shared";
import type { WorkspaceFileEntry } from "../../../workspace";
import type {
  ManifestReader,
  ManifestReaderInput,
  ProjectManifestInfo,
} from "../../types";

export interface PyprojectReaderOptions {
  /**
   * Maximum pyproject.toml size accepted by this reader.
   *
   * Default: 1 MiB
   */
  maximumBytes?: number;
}

interface RawPyprojectToml {
  project?: unknown;
  tool?: unknown;
  "dependency-groups"?: unknown;
}

const DEFAULT_MAXIMUM_BYTES = 1024 * 1024;

const COMMON_SOURCE_ROOTS = ["src"] as const;
const COMMON_TEST_ROOTS = ["tests", "test"] as const;
const COMMON_ENTRY_FILES = ["main.py", "app.py"] as const;

export class PyprojectReader implements ManifestReader {
  public readonly id = "pyproject";

  public readonly priority = 10;

  private readonly maximumBytes: number;

  constructor(
    private readonly fileSystem: FileSystemReadPort,
    options: PyprojectReaderOptions = {},
  ) {
    this.maximumBytes = options.maximumBytes ?? DEFAULT_MAXIMUM_BYTES;

    this.validateMaximumBytes(this.maximumBytes);
  }

  public supports(manifest: WorkspaceFileEntry): boolean {
    return (
      path.posix
        .basename(this.normalizeRelativePath(manifest.relativePath))
        .toLowerCase() === "pyproject.toml"
    );
  }

  public async read(input: ManifestReaderInput): Promise<ProjectManifestInfo> {
    if (!this.supports(input.manifest)) {
      throw new Error(
        `PyprojectReader does not support "${input.manifest.relativePath}".`,
      );
    }

    const providerPath = input.manifest.providerPath;

    if (!providerPath) {
      throw new Error(
        `Cannot read pyproject manifest "${input.manifest.relativePath}" ` +
          "because providerPath is missing.",
      );
    }

    const content = await this.fileSystem.readText(providerPath, {
      encoding: "utf8",
      maximumBytes: this.maximumBytes,
    });

    const manifest = this.parseManifest(content, input.manifest.relativePath);
    const project = this.asRecord(manifest.project);
    const poetry = this.asRecord(this.asRecord(manifest.tool)?.poetry);

    const declaredName = this.firstString(project?.name, poetry?.name);
    const normalizedPackageName = this.normalizePythonImportName(declaredName);

    const projectEntryPaths = this.collectProjectEntryPaths(
      input.projectEntries,
      input.relativeRoot,
    );

    const packageRootCandidates = normalizedPackageName
      ? [
          normalizedPackageName,
          `src/${normalizedPackageName}`,
        ]
      : [];

    return {
      readerId: this.id,
      ecosystem: "python",

      relativeRoot: this.normalizeProjectRoot(input.relativeRoot),

      manifestPaths: [this.normalizeRelativePath(input.manifest.relativePath)],

      ...this.optionalStringProperty("declaredName", declaredName),

      ...this.optionalStringProperty(
        "declaredVersion",
        this.firstString(project?.version, poetry?.version),
      ),

      scripts: {
        build: "python -m build",
        test: "pytest",
      },

      dependencies: this.uniqueStrings([
        ...this.readPep621Dependencies(project?.dependencies),
        ...this.readPoetryDependencies(
          this.asRecord(poetry?.dependencies),
          new Set(["python"]),
        ),
      ]),

      developmentDependencies: this.uniqueStrings([
        ...this.readPep621OptionalDependencies(project?.["optional-dependencies"]),
        ...this.readPep735DependencyGroups(manifest["dependency-groups"]),
        ...this.readPoetryDependencies(this.asRecord(poetry?.["dev-dependencies"])),
        ...this.readPoetryGroupDependencies(poetry?.group),
      ]),

      suggestedEntryFiles: this.resolveSuggestedEntryFiles(
        projectEntryPaths,
        packageRootCandidates,
      ),
      suggestedSourceRoots: this.detectExistingRoots(projectEntryPaths, [
        ...COMMON_SOURCE_ROOTS,
        ...packageRootCandidates,
      ]),
      suggestedTestRoots: this.detectExistingRoots(
        projectEntryPaths,
        COMMON_TEST_ROOTS,
      ),
    };
  }

  private parseManifest(content: string, relativePath: string): RawPyprojectToml {
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
        `Python manifest "${relativePath}" must contain a TOML table.`,
      );
    }

    return parsed as RawPyprojectToml;
  }

  private readPep621Dependencies(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((dependency) => this.parsePythonDependencyName(dependency))
      .filter((name): name is string => Boolean(name))
      .sort((left, right) => left.localeCompare(right));
  }

  private readPep621OptionalDependencies(value: unknown): string[] {
    const record = this.asRecord(value);

    if (!record) {
      return [];
    }

    return this.uniqueStrings(
      Object.values(record).flatMap((dependencies) =>
        this.readPep621Dependencies(dependencies),
      ),
    );
  }

  private readPep735DependencyGroups(value: unknown): string[] {
    const record = this.asRecord(value);

    if (!record) {
      return [];
    }

    return this.uniqueStrings(
      Object.values(record).flatMap((dependencies) =>
        this.readPep621Dependencies(dependencies),
      ),
    );
  }

  private readPoetryDependencies(
    value: Record<string, unknown> | undefined,
    ignoredNames: ReadonlySet<string> = new Set(),
  ): string[] {
    if (!value) {
      return [];
    }

    return Object.keys(value)
      .map((name) => name.trim())
      .filter(
        (name) => name && !ignoredNames.has(name.toLowerCase()),
      )
      .sort((left, right) => left.localeCompare(right));
  }

  private readPoetryGroupDependencies(value: unknown): string[] {
    const groups = this.asRecord(value);

    if (!groups) {
      return [];
    }

    return this.uniqueStrings(
      Object.values(groups).flatMap((group) => {
        const dependencies = this.asRecord(group)?.dependencies;

        return this.readPoetryDependencies(this.asRecord(dependencies));
      }),
    );
  }

  private parsePythonDependencyName(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const withoutMarker = value.split(";")[0]?.trim() ?? "";
    const match = withoutMarker.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/);

    return match?.[1];
  }

  private resolveSuggestedEntryFiles(
    projectEntryPaths: ReadonlySet<string>,
    packageRoots: readonly string[],
  ): string[] {
    const candidates = [
      ...COMMON_ENTRY_FILES,
      ...packageRoots.flatMap((root) => [
        `${root}/__main__.py`,
        `${root}/__init__.py`,
      ]),
    ];

    return this.detectExistingPaths(projectEntryPaths, candidates);
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

    for (const rawCandidate of candidates) {
      const candidate = this.readProjectRelativePath(rawCandidate);

      if (!candidate) {
        continue;
      }

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

  private detectExistingPaths(
    projectEntryPaths: ReadonlySet<string>,
    candidates: readonly string[],
  ): string[] {
    return this.normalizeUniquePaths(
      candidates.filter((candidate) =>
        projectEntryPaths.has(this.normalizeRelativePath(candidate)),
      ),
    );
  }

  private readProjectRelativePath(value: unknown): string | undefined {
    const text = typeof value === "string" ? value.trim() : "";

    if (!text) {
      return undefined;
    }

    const normalized = this.normalizeRelativePath(text);

    if (
      !normalized ||
      normalized.startsWith("../") ||
      normalized === ".." ||
      path.posix.isAbsolute(text) ||
      /^[a-zA-Z]:[\\/]/.test(text)
    ) {
      return undefined;
    }

    return normalized;
  }

  private normalizePythonImportName(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const normalized = value.trim().replace(/[-.]+/g, "_");

    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)
      ? normalized
      : undefined;
  }

  private firstString(...values: unknown[]): string | undefined {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }

    return undefined;
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

  private normalizeUniquePaths(values: readonly string[]): string[] {
    const normalized = values
      .map((value) => this.normalizeRelativePath(value))
      .filter(Boolean);

    return [...new Set(normalized)].sort((left, right) =>
      left.localeCompare(right),
    );
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
