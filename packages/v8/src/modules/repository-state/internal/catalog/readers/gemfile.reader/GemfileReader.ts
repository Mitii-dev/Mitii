import * as path from "node:path";

import type { FileSystemReadPort } from "../../../shared";
import type { WorkspaceFileEntry } from "../../../workspace";
import type {
  ManifestReader,
  ManifestReaderInput,
  ProjectManifestInfo,
} from "../../types";

export interface GemfileReaderOptions {
  /**
   * Maximum Gemfile size accepted by this reader.
   *
   * Default: 1 MiB
   */
  maximumBytes?: number;
}

const DEFAULT_MAXIMUM_BYTES = 1024 * 1024;

const COMMON_ENTRY_FILES = [
  "config/application.rb",
  "config.ru",
  "app.rb",
] as const;
const COMMON_SOURCE_ROOTS = ["app", "lib"] as const;
const COMMON_TEST_ROOTS = ["spec", "test"] as const;
const DEVELOPMENT_GROUPS = new Set(["development", "test"]);

export class GemfileReader implements ManifestReader {
  public readonly id = "gemfile";

  public readonly priority = 10;

  private readonly maximumBytes: number;

  constructor(
    private readonly fileSystem: FileSystemReadPort,
    options: GemfileReaderOptions = {},
  ) {
    this.maximumBytes = options.maximumBytes ?? DEFAULT_MAXIMUM_BYTES;

    this.validateMaximumBytes(this.maximumBytes);
  }

  public supports(manifest: WorkspaceFileEntry): boolean {
    return (
      path.posix
        .basename(this.normalizeRelativePath(manifest.relativePath))
        .toLowerCase() === "gemfile"
    );
  }

  public async read(input: ManifestReaderInput): Promise<ProjectManifestInfo> {
    if (!this.supports(input.manifest)) {
      throw new Error(
        `GemfileReader does not support "${input.manifest.relativePath}".`,
      );
    }

    const providerPath = input.manifest.providerPath;

    if (!providerPath) {
      throw new Error(
        `Cannot read Gemfile "${input.manifest.relativePath}" ` +
          "because providerPath is missing.",
      );
    }

    const content = await this.fileSystem.readText(providerPath, {
      encoding: "utf8",
      maximumBytes: this.maximumBytes,
    });

    const dependencies = this.parseDependencies(content);
    const projectEntryPaths = this.collectProjectEntryPaths(
      input.projectEntries,
      input.relativeRoot,
    );
    const declaredName = this.findGemspecName(projectEntryPaths);

    return {
      readerId: this.id,
      ecosystem: "ruby",

      relativeRoot: this.normalizeProjectRoot(input.relativeRoot),

      manifestPaths: [this.normalizeRelativePath(input.manifest.relativePath)],

      ...this.optionalStringProperty("declaredName", declaredName),

      scripts: {
        install: "bundle install",
        test: "bundle exec rspec",
      },

      dependencies: dependencies.runtime,
      developmentDependencies: dependencies.development,

      suggestedEntryFiles: this.resolveSuggestedEntryFiles(
        projectEntryPaths,
        declaredName,
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

  private parseDependencies(content: string): {
    runtime: string[];
    development: string[];
  } {
    const runtime = new Set<string>();
    const development = new Set<string>();
    const groupStack: boolean[] = [];

    for (const rawLine of content.split(/\r?\n/)) {
      const line = this.stripInlineComment(rawLine).trim();

      if (!line) {
        continue;
      }

      const groupDeclaration = line.match(/^group\s+(.+?)\s+do\b/);

      if (groupDeclaration) {
        groupStack.push(this.containsDevelopmentGroup(groupDeclaration[1]));
        continue;
      }

      if (line === "end" || line.startsWith("end ")) {
        groupStack.pop();
        continue;
      }

      const gemName = this.readGemName(line);

      if (!gemName) {
        continue;
      }

      if (
        groupStack.includes(true) ||
        this.containsDevelopmentGroup(line)
      ) {
        development.add(gemName);
      } else {
        runtime.add(gemName);
      }
    }

    return {
      runtime: [...runtime].sort((left, right) => left.localeCompare(right)),
      development: [...development].sort((left, right) =>
        left.localeCompare(right),
      ),
    };
  }

  private readGemName(line: string): string | undefined {
    const match = line.match(/^gem\s*(?:\(?\s*)["']([^"']+)["']/);
    const name = match?.[1]?.trim();

    return name || undefined;
  }

  private containsDevelopmentGroup(value: string): boolean {
    const groups = [...value.matchAll(/:(\w+)/g)].map((match) =>
      match[1].toLowerCase(),
    );

    return groups.some((group) => DEVELOPMENT_GROUPS.has(group));
  }

  private stripInlineComment(line: string): string {
    let quote: "'" | "\"" | undefined;
    let escaped = false;

    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === "\\") {
        escaped = true;
        continue;
      }

      if (quote) {
        if (character === quote) {
          quote = undefined;
        }

        continue;
      }

      if (character === "'" || character === "\"") {
        quote = character;
        continue;
      }

      if (character === "#") {
        return line.slice(0, index);
      }
    }

    return line;
  }

  private findGemspecName(projectEntryPaths: ReadonlySet<string>): string | undefined {
    const gemspec = [...projectEntryPaths]
      .filter((entryPath) => entryPath.endsWith(".gemspec"))
      .sort((left, right) => left.localeCompare(right))[0];

    if (!gemspec) {
      return undefined;
    }

    return path.posix.basename(gemspec, ".gemspec");
  }

  private resolveSuggestedEntryFiles(
    projectEntryPaths: ReadonlySet<string>,
    declaredName: string | undefined,
  ): string[] {
    const candidates: string[] = [...COMMON_ENTRY_FILES];

    if (declaredName) {
      candidates.push(`lib/${declaredName}.rb`);
    }

    return this.normalizeUniquePaths(
      candidates.filter((candidate) =>
        projectEntryPaths.has(this.normalizeRelativePath(candidate)),
      ),
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
}
