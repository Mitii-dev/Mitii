import * as path from "node:path";

import type { FileSystemReadPort } from "../../../shared";
import type { WorkspaceFileEntry } from "../../../workspace";
import type {
  ManifestReader,
  ManifestReaderInput,
  ProjectManifestInfo,
} from "../../types";

export interface ComposerJsonReaderOptions {
  /**
   * Maximum composer.json size accepted by this reader.
   *
   * Default: 1 MiB
   */
  maximumBytes?: number;
}

interface RawComposerJson {
  name?: unknown;
  version?: unknown;
  require?: unknown;
  "require-dev"?: unknown;
  scripts?: unknown;
  autoload?: unknown;
  "autoload-dev"?: unknown;
  bin?: unknown;
}

const DEFAULT_MAXIMUM_BYTES = 1024 * 1024;

const COMMON_SOURCE_ROOTS = ["src"] as const;
const COMMON_TEST_ROOTS = ["tests", "test"] as const;

export class ComposerJsonReader implements ManifestReader {
  public readonly id = "composer-json";

  public readonly priority = 10;

  private readonly maximumBytes: number;

  constructor(
    private readonly fileSystem: FileSystemReadPort,
    options: ComposerJsonReaderOptions = {},
  ) {
    this.maximumBytes = options.maximumBytes ?? DEFAULT_MAXIMUM_BYTES;

    this.validateMaximumBytes(this.maximumBytes);
  }

  public supports(manifest: WorkspaceFileEntry): boolean {
    return (
      path.posix
        .basename(this.normalizeRelativePath(manifest.relativePath))
        .toLowerCase() === "composer.json"
    );
  }

  public async read(input: ManifestReaderInput): Promise<ProjectManifestInfo> {
    if (!this.supports(input.manifest)) {
      throw new Error(
        `ComposerJsonReader does not support "${input.manifest.relativePath}".`,
      );
    }

    const providerPath = input.manifest.providerPath;

    if (!providerPath) {
      throw new Error(
        `Cannot read Composer manifest "${input.manifest.relativePath}" ` +
          "because providerPath is missing.",
      );
    }

    const content = await this.fileSystem.readText(providerPath, {
      encoding: "utf8",
      maximumBytes: this.maximumBytes,
    });

    const manifest = this.parseManifest(content, input.manifest.relativePath);

    const projectEntryPaths = this.collectProjectEntryPaths(
      input.projectEntries,
      input.relativeRoot,
    );

    const declaredSourceRoots = this.extractAutoloadRoots(manifest.autoload);
    const declaredTestRoots = this.extractAutoloadRoots(manifest["autoload-dev"]);

    return {
      readerId: this.id,
      ecosystem: "php",

      relativeRoot: this.normalizeProjectRoot(input.relativeRoot),

      manifestPaths: [this.normalizeRelativePath(input.manifest.relativePath)],

      ...this.optionalStringProperty("declaredName", manifest.name),

      ...this.optionalStringProperty("declaredVersion", manifest.version),

      scripts: this.readScripts(manifest.scripts),

      dependencies: this.readDependencyNames(manifest.require),
      developmentDependencies: this.readDependencyNames(manifest["require-dev"]),

      suggestedEntryFiles: this.resolveSuggestedEntryFiles(
        manifest.bin,
        projectEntryPaths,
      ),
      suggestedSourceRoots: this.detectExistingRoots(projectEntryPaths, [
        ...declaredSourceRoots,
        ...COMMON_SOURCE_ROOTS,
      ]),
      suggestedTestRoots: this.detectExistingRoots(projectEntryPaths, [
        ...declaredTestRoots,
        ...COMMON_TEST_ROOTS,
      ]),
    };
  }

  private parseManifest(content: string, relativePath: string): RawComposerJson {
    let parsed: unknown;

    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new Error(
        `Invalid JSON in "${relativePath}": ${this.errorMessage(error)}`,
      );
    }

    if (!this.isRecord(parsed)) {
      throw new Error(
        `Composer manifest "${relativePath}" must contain a JSON object.`,
      );
    }

    return parsed;
  }

  private readDependencyNames(value: unknown): string[] {
    const record = this.asRecord(value);

    if (!record) {
      return [];
    }

    return Object.keys(record)
      .map((name) => name.trim())
      .filter((name) => name && !this.isPlatformRequirement(name))
      .sort((left, right) => left.localeCompare(right));
  }

  private readScripts(value: unknown): Record<string, string> {
    const record = this.asRecord(value);

    if (!record) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(record)
        .map(([name, command]) => [name.trim(), this.stringifyScript(command)])
        .filter(
          (entry): entry is [string, string] =>
            Boolean(entry[0]) && Boolean(entry[1]),
        )
        .sort(([left], [right]) => left.localeCompare(right)),
    );
  }

  private stringifyScript(value: unknown): string | undefined {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (Array.isArray(value)) {
      const commands = value
        .filter((command): command is string => typeof command === "string")
        .map((command) => command.trim())
        .filter(Boolean);

      return commands.length > 0 ? commands.join(" && ") : undefined;
    }

    return undefined;
  }

  private extractAutoloadRoots(value: unknown): string[] {
    const autoload = this.asRecord(value);

    if (!autoload) {
      return [];
    }

    const roots: string[] = [];

    for (const key of ["psr-4", "psr-0", "classmap"] as const) {
      roots.push(...this.extractAutoloadSectionRoots(autoload[key]));
    }

    return this.normalizeUniquePaths(roots);
  }

  private extractAutoloadSectionRoots(value: unknown): string[] {
    if (typeof value === "string") {
      return [value];
    }

    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string");
    }

    const record = this.asRecord(value);

    if (!record) {
      return [];
    }

    return Object.values(record).flatMap((entry) =>
      this.extractAutoloadSectionRoots(entry),
    );
  }

  private resolveSuggestedEntryFiles(
    value: unknown,
    projectEntryPaths: ReadonlySet<string>,
  ): string[] {
    const declaredBins =
      typeof value === "string"
        ? [value]
        : Array.isArray(value)
          ? value.filter((entry): entry is string => typeof entry === "string")
          : [];

    return this.normalizeUniquePaths(
      declaredBins.filter((entry) =>
        projectEntryPaths.has(this.normalizeRelativePath(entry)),
      ),
    );
  }

  private isPlatformRequirement(name: string): boolean {
    const normalized = name.toLowerCase();

    return (
      normalized === "php" ||
      normalized.startsWith("ext-") ||
      normalized.startsWith("lib-")
    );
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
