import { XMLParser } from "fast-xml-parser";
import * as path from "node:path";

import type { FileSystemReadPort } from "../../../shared";
import type { WorkspaceFileEntry } from "../../../workspace";
import type {
  ManifestReader,
  ManifestReaderInput,
  ProjectManifestInfo,
} from "../../types";

export interface DotnetProjectReaderOptions {
  /**
   * Maximum project file size accepted by this reader.
   *
   * Default: 1 MiB
   */
  maximumBytes?: number;
}

interface ParsedXmlDocument {
  Project?: unknown;
}

interface RawDotnetProject {
  PropertyGroup?: unknown;
  ItemGroup?: unknown;
}

interface PackageReference {
  Include?: unknown;
  Update?: unknown;
  Version?: unknown;
  PrivateAssets?: unknown;
}

const DEFAULT_MAXIMUM_BYTES = 1024 * 1024;

const COMMON_ENTRY_FILE_NAMES = new Set([
  "Program.cs",
  "Startup.cs",
  "App.xaml.cs",
]);

const COMMON_SOURCE_ROOTS = [
  "src",
  "Controllers",
  "Pages",
  "Views",
  "Services",
  "Models",
] as const;

const COMMON_TEST_ROOTS = ["Tests", "tests"] as const;

const DEVELOPMENT_PACKAGE_NAMES = new Set([
  "coverlet.collector",
  "coverlet.msbuild",
  "fluentassertions",
  "microsoft.net.test.sdk",
  "moq",
  "nunit",
  "nunit3testadapter",
  "xunit",
  "xunit.runner.visualstudio",
]);

export class DotnetProjectReader implements ManifestReader {
  public readonly id = "dotnet-project";

  public readonly priority = 10;

  private readonly maximumBytes: number;

  private readonly parser: XMLParser;

  constructor(
    private readonly fileSystem: FileSystemReadPort,
    options: DotnetProjectReaderOptions = {},
  ) {
    this.maximumBytes = options.maximumBytes ?? DEFAULT_MAXIMUM_BYTES;

    this.validateMaximumBytes(this.maximumBytes);

    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: true,
      processEntities: false,
      htmlEntities: false,
    });
  }

  public supports(manifest: WorkspaceFileEntry): boolean {
    const fileName = path.posix
      .basename(this.normalizeRelativePath(manifest.relativePath))
      .toLowerCase();

    return (
      fileName.endsWith(".csproj") ||
      fileName.endsWith(".fsproj") ||
      fileName.endsWith(".vbproj")
    );
  }

  public async read(input: ManifestReaderInput): Promise<ProjectManifestInfo> {
    if (!this.supports(input.manifest)) {
      throw new Error(
        `DotnetProjectReader does not support "${input.manifest.relativePath}".`,
      );
    }

    const providerPath = input.manifest.providerPath;

    if (!providerPath) {
      throw new Error(
        `Cannot read .NET project "${input.manifest.relativePath}" ` +
          "because providerPath is missing.",
      );
    }

    const content = await this.fileSystem.readText(providerPath, {
      encoding: "utf8",
      maximumBytes: this.maximumBytes,
    });

    const project = this.parseProject(content, input.manifest.relativePath);
    const properties = this.collectProperties(project.PropertyGroup);
    const packages = this.extractPackageReferences(project);
    const projectEntryPaths = this.collectProjectEntryPaths(
      input.projectEntries,
      input.relativeRoot,
    );

    const manifestFileName = path.posix.basename(
      this.normalizeRelativePath(input.manifest.relativePath),
    );
    const fallbackName = path.posix.basename(
      manifestFileName,
      path.posix.extname(manifestFileName),
    );

    return {
      readerId: this.id,
      ecosystem: "dotnet",

      relativeRoot: this.normalizeProjectRoot(input.relativeRoot),

      manifestPaths: [this.normalizeRelativePath(input.manifest.relativePath)],

      ...this.optionalStringProperty(
        "declaredName",
        this.firstString(
          properties.AssemblyName,
          properties.PackageId,
          properties.RootNamespace,
          fallbackName,
        ),
      ),

      ...this.optionalStringProperty(
        "declaredVersion",
        this.firstString(
          properties.Version,
          properties.PackageVersion,
          properties.AssemblyVersion,
        ),
      ),

      scripts: {
        build: "dotnet build",
        restore: "dotnet restore",
        test: "dotnet test",
      },

      dependencies: this.uniqueStrings(
        packages
          .filter((dependency) => !dependency.development)
          .map((dependency) => dependency.name),
      ),
      developmentDependencies: this.uniqueStrings(
        packages
          .filter((dependency) => dependency.development)
          .map((dependency) => dependency.name),
      ),

      suggestedEntryFiles: this.findEntryFiles(projectEntryPaths),
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

  private parseProject(content: string, relativePath: string): RawDotnetProject {
    let parsed: unknown;

    try {
      parsed = this.parser.parse(content);
    } catch (error) {
      throw new Error(
        `Invalid XML in "${relativePath}": ${this.errorMessage(error)}`,
      );
    }

    if (!this.isRecord(parsed)) {
      throw new Error(
        `.NET project "${relativePath}" did not produce an XML document object.`,
      );
    }

    const document = parsed as ParsedXmlDocument;

    if (!this.isRecord(document.Project)) {
      throw new Error(
        `.NET project "${relativePath}" does not contain a <Project> root.`,
      );
    }

    return document.Project as RawDotnetProject;
  }

  private collectProperties(value: unknown): Record<string, string> {
    const properties: Record<string, string> = {};

    for (const propertyGroup of this.toArray(value)) {
      const group = this.asRecord(propertyGroup);

      if (!group) {
        continue;
      }

      for (const [key, rawValue] of Object.entries(group)) {
        const text = this.readString(rawValue);

        if (text && properties[key] === undefined) {
          properties[key] = text;
        }
      }
    }

    return properties;
  }

  private extractPackageReferences(project: RawDotnetProject): {
    name: string;
    development: boolean;
  }[] {
    const packages = new Map<string, boolean>();

    for (const itemGroup of this.toArray(project.ItemGroup)) {
      const group = this.asRecord(itemGroup);

      if (!group) {
        continue;
      }

      for (const rawReference of this.toArray(group.PackageReference)) {
        const reference = this.asRecord(rawReference) as
          | PackageReference
          | undefined;

        const name = this.firstString(reference?.Include, reference?.Update);

        if (!name) {
          continue;
        }

        const development = this.isDevelopmentPackageReference(reference);
        packages.set(name, (packages.get(name) ?? false) || development);
      }
    }

    return [...packages.entries()]
      .map(([name, development]) => ({ name, development }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  private isDevelopmentPackageReference(
    reference: PackageReference | undefined,
  ): boolean {
    if (!reference) {
      return false;
    }

    const name = this.firstString(reference.Include, reference.Update);
    const privateAssets = this.readString(reference.PrivateAssets)?.toLowerCase();

    return (
      privateAssets === "all" ||
      (name !== undefined &&
        DEVELOPMENT_PACKAGE_NAMES.has(name.trim().toLowerCase()))
    );
  }

  private findEntryFiles(projectEntryPaths: ReadonlySet<string>): string[] {
    return [...projectEntryPaths]
      .filter((entryPath) =>
        COMMON_ENTRY_FILE_NAMES.has(path.posix.basename(entryPath)),
      )
      .sort((left, right) => left.localeCompare(right));
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

  private firstString(...values: unknown[]): string | undefined {
    for (const value of values) {
      const text = this.readString(value);

      if (text) {
        return text;
      }
    }

    return undefined;
  }

  private readString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const normalized = value.trim();

    return normalized || undefined;
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
