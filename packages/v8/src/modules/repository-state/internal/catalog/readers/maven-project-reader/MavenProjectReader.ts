import { XMLParser } from "fast-xml-parser";
import * as path from "node:path";

import type { FileSystemReadPort } from "../../../shared";

import type { WorkspaceFileEntry } from "../../../workspace";

import type {
  ManifestReader,
  ManifestReaderInput,
  ProjectManifestInfo,
} from "../../types";

export interface MavenReaderOptions {
  /**
   * Maximum accepted pom.xml size.
   *
   * Default: 1 MiB
   */
  maximumBytes?: number;
}

interface RawPomProject {
  modelVersion?: unknown;

  groupId?: unknown;
  artifactId?: unknown;
  version?: unknown;
  name?: unknown;
  packaging?: unknown;

  parent?: {
    groupId?: unknown;
    artifactId?: unknown;
    version?: unknown;
  };

  dependencies?: {
    dependency?: RawDependency | RawDependency[];
  };

  build?: {
    sourceDirectory?: unknown;
    testSourceDirectory?: unknown;

    plugins?: {
      plugin?: RawPlugin | RawPlugin[];
    };
  };
}

interface RawDependency {
  groupId?: unknown;
  artifactId?: unknown;
  version?: unknown;
  scope?: unknown;
  optional?: unknown;
}

interface RawPlugin {
  groupId?: unknown;
  artifactId?: unknown;
}

interface ParsedXmlDocument {
  project?: unknown;
}

const DEFAULT_MAXIMUM_BYTES = 1024 * 1024;

const COMMON_SOURCE_ROOTS = [
  "src/main/java",
  "src/main/kotlin",
  "src/main/scala",
  "src/main/resources",
] as const;

const COMMON_TEST_ROOTS = [
  "src/test/java",
  "src/test/kotlin",
  "src/test/scala",
  "src/test/resources",
] as const;

const MAIN_CLASS_PATTERNS = [
  /^src\/main\/java\/.+Application\.java$/,
  /^src\/main\/kotlin\/.+Application\.kt$/,
  /^src\/main\/scala\/.+Application\.scala$/,
  /^src\/main\/java\/.+Main\.java$/,
  /^src\/main\/kotlin\/.+Main\.kt$/,
  /^src\/main\/scala\/.+Main\.scala$/,
] as const;

export class MavenProjectReader implements ManifestReader {
  public readonly id = "maven";

  public readonly priority = 10;

  private readonly maximumBytes: number;

  private readonly parser: XMLParser;

  constructor(
    private readonly fileSystem: FileSystemReadPort,
    options: MavenReaderOptions = {},
  ) {
    this.maximumBytes = options.maximumBytes ?? DEFAULT_MAXIMUM_BYTES;

    this.validateMaximumBytes(this.maximumBytes);

    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",

      /*
       * Keep Maven values as strings.
       *
       * Versions such as "1.0" must not become numbers,
       * and values such as "true" should remain textual
       * manifest data.
       */
      parseTagValue: false,
      parseAttributeValue: false,

      trimValues: true,

      /*
       * Maven POM parsing does not require entity
       * processing. Disabling it reduces unnecessary
       * parser behavior for untrusted repository files.
       */
      processEntities: false,
      htmlEntities: false,
    });
  }

  public supports(manifest: WorkspaceFileEntry): boolean {
    const fileName = path.posix
      .basename(this.normalizeRelativePath(manifest.relativePath))
      .toLowerCase();

    return fileName === "pom.xml";
  }

  public async read(input: ManifestReaderInput): Promise<ProjectManifestInfo> {
    if (!this.supports(input.manifest)) {
      throw new Error(
        `MavenProjectReader does not support ` +
          `"${input.manifest.relativePath}".`,
      );
    }

    const providerPath = input.manifest.providerPath;

    if (!providerPath) {
      throw new Error(
        `Cannot read POM ` +
          `"${input.manifest.relativePath}" because ` +
          "providerPath is missing.",
      );
    }

    const content = await this.fileSystem.readText(providerPath, {
      encoding: "utf8",
      maximumBytes: this.maximumBytes,
    });

    const pom = this.parsePom(content, input.manifest.relativePath);

    const dependencies = this.extractDependencies(
      pom,
      new Set(["compile", "runtime", "provided", "system"]),
    );

    const developmentDependencies = this.extractDependencies(
      pom,
      new Set(["test"]),
    );

    const projectEntryPaths = this.collectProjectEntryPaths(
      input.projectEntries,
      input.relativeRoot,
    );

    const declaredSourceDirectory = this.readProjectRelativePath(
      pom.build?.sourceDirectory,
    );

    const declaredTestDirectory = this.readProjectRelativePath(
      pom.build?.testSourceDirectory,
    );

    const sourceCandidates = this.uniqueStrings([
      ...(declaredSourceDirectory ? [declaredSourceDirectory] : []),

      ...COMMON_SOURCE_ROOTS,
    ]);

    const testCandidates = this.uniqueStrings([
      ...(declaredTestDirectory ? [declaredTestDirectory] : []),

      ...COMMON_TEST_ROOTS,
    ]);

    const suggestedSourceRoots = this.detectExistingRoots(
      projectEntryPaths,
      sourceCandidates,
    );

    const suggestedTestRoots = this.detectExistingRoots(
      projectEntryPaths,
      testCandidates,
    );

    const suggestedEntryFiles = this.findMainClasses(projectEntryPaths);

    const declaredName = this.firstString(pom.name, pom.artifactId);

    const declaredVersion = this.firstString(pom.version, pom.parent?.version);

    return {
      readerId: this.id,
      ecosystem: "java",

      relativeRoot: this.normalizeProjectRoot(input.relativeRoot),

      manifestPaths: [this.normalizeRelativePath(input.manifest.relativePath)],

      ...(declaredName
        ? {
            declaredName,
          }
        : {}),

      ...(declaredVersion
        ? {
            declaredVersion,
          }
        : {}),

      /*
       * Maven lifecycle commands are conventional,
       * not user-declared scripts in pom.xml.
       *
       * Keep this factual by returning no invented
       * script aliases.
       */
      scripts: {},

      dependencies,
      developmentDependencies,

      suggestedEntryFiles,
      suggestedSourceRoots,
      suggestedTestRoots,
    };
  }

  private parsePom(content: string, relativePath: string): RawPomProject {
    let parsed: unknown;

    try {
      parsed = this.parser.parse(content);
    } catch (error) {
      throw new Error(
        `Invalid XML in "${relativePath}": ` + this.errorMessage(error),
      );
    }

    if (!this.isRecord(parsed)) {
      throw new Error(
        `POM "${relativePath}" did not produce ` + "an XML document object.",
      );
    }

    const document = parsed as ParsedXmlDocument;

    if (!this.isRecord(document.project)) {
      throw new Error(
        `POM "${relativePath}" does not contain ` + "a <project> root element.",
      );
    }

    const project = document.project as RawPomProject;

    const artifactId = this.readString(project.artifactId);

    if (!artifactId) {
      throw new Error(
        `POM "${relativePath}" does not declare ` + "a valid <artifactId>.",
      );
    }

    return project;
  }

  private extractDependencies(
    pom: RawPomProject,
    includedScopes: ReadonlySet<string>,
  ): string[] {
    const dependencies = new Set<string>();

    const declarations = this.toArray(pom.dependencies?.dependency);

    for (const dependency of declarations) {
      if (!this.isRecord(dependency)) {
        continue;
      }

      const groupId = this.readString(dependency.groupId);

      const artifactId = this.readString(dependency.artifactId);

      if (!groupId || !artifactId) {
        continue;
      }

      const scope =
        this.readString(dependency.scope)?.toLowerCase() ?? "compile";

      if (!includedScopes.has(scope)) {
        continue;
      }

      dependencies.add(`${groupId}:${artifactId}`);
    }

    return [...dependencies].sort((left, right) => left.localeCompare(right));
  }

  /**
   * Finds conventional entry-class filenames.
   *
   * This is based on files that actually exist in the
   * workspace snapshot. It does not classify the project.
   */
  private findMainClasses(projectEntries: ReadonlySet<string>): string[] {
    return [...projectEntries]
      .filter((entryPath) =>
        MAIN_CLASS_PATTERNS.some((pattern) => pattern.test(entryPath)),
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
    paths: ReadonlySet<string>,
    candidates: readonly string[],
  ): string[] {
    const roots = new Set<string>();

    for (const rawCandidate of candidates) {
      const candidate = this.readProjectRelativePath(rawCandidate);

      if (!candidate) {
        continue;
      }

      const prefix = `${candidate}/`;

      const exists = [...paths].some(
        (entryPath) => entryPath === candidate || entryPath.startsWith(prefix),
      );

      if (exists) {
        roots.add(candidate);
      }
    }

    return [...roots].sort((left, right) => left.localeCompare(right));
  }

  /**
   * Normalizes a path declared inside pom.xml.
   *
   * Absolute paths and paths escaping the project root
   * are rejected.
   */
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

  private normalizeProjectRoot(value: string): string {
    if (!value.trim()) {
      return "";
    }

    return this.normalizeRelativePath(value);
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

  private toArray<T>(value: T | readonly T[] | undefined): readonly T[] {
    if (value === undefined) {
      return [];
    }

    return Array.isArray(value) ? value : [value as T];
  }

  private uniqueStrings(values: readonly string[]): string[] {
    return [
      ...new Set(values.map((value) => value.trim()).filter(Boolean)),
    ].sort((left, right) => left.localeCompare(right));
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private validateMaximumBytes(maximumBytes: number): void {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
      throw new RangeError("maximumBytes must be a positive safe integer.");
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }
}
