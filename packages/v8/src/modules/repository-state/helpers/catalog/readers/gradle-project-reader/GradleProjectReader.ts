import * as path from "node:path";

import type { FileSystemReadPort } from "../../../shared";
import type { WorkspaceFileEntry } from "../../../workspace";
import type {
  ManifestReader,
  ManifestReaderInput,
  ProjectManifestInfo,
} from "../../types";

export interface GradleReaderOptions {
  maximumBytes?: number; // default 1 MiB
}

const DEFAULT_MAXIMUM_BYTES = 1024 * 1024;

const SOURCE_ROOTS = ["src/main/java", "src/main/kotlin", "src/main/scala"];
const TEST_ROOTS = ["src/test/java", "src/test/kotlin", "src/test/scala"];

export class GradleProjectReader implements ManifestReader {
  public readonly id = "gradle";
  public readonly priority = 10;

  private readonly maximumBytes: number;

  constructor(
    private readonly fileSystem: FileSystemReadPort,
    options: GradleReaderOptions = {},
  ) {
    this.maximumBytes = options.maximumBytes ?? DEFAULT_MAXIMUM_BYTES;
    if (!Number.isSafeInteger(this.maximumBytes) || this.maximumBytes <= 0) {
      throw new RangeError("maximumBytes must be a positive safe integer.");
    }
  }

  public supports(manifest: WorkspaceFileEntry): boolean {
    const fileName = path.posix
      .basename(this.normalizeRelativePath(manifest.relativePath))
      .toLowerCase();
    return fileName === "build.gradle" || fileName === "build.gradle.kts";
  }

  public async read(input: ManifestReaderInput): Promise<ProjectManifestInfo> {
    if (!this.supports(input.manifest)) {
      throw new Error(
        `GradleProjectReader does not support "${input.manifest.relativePath}".`,
      );
    }

    const providerPath = input.manifest.providerPath;
    if (!providerPath) {
      throw new Error(
        `Cannot read Gradle build file "${input.manifest.relativePath}" — no providerPath.`,
      );
    }

    const content = await this.fileSystem.readText(providerPath, {
      encoding: "utf8",
      maximumBytes: this.maximumBytes,
    });

    const isKotlin = input.manifest.relativePath.toLowerCase().endsWith(".kts");
    const dependencies = this.extractDependencies(content, isKotlin);
    const devDependencies = this.extractDevDependencies(content, isKotlin);

    const projectEntryPaths = this.collectProjectEntryPaths(
      input.projectEntries,
      input.relativeRoot,
    );

    const sourceRoots = this.detectExistingRoots(
      projectEntryPaths,
      SOURCE_ROOTS,
    );
    const testRoots = this.detectExistingRoots(projectEntryPaths, TEST_ROOTS);
    const entryFiles = this.findApplicationClasses(projectEntryPaths);

    const scripts: Record<string, string> = {
      build: "gradle build",
      test: "gradle test",
    };

    return {
      readerId: this.id,
      ecosystem: "java",

      relativeRoot: input.relativeRoot,
      manifestPaths: [this.normalizeRelativePath(input.manifest.relativePath)],

      scripts,
      dependencies,
      developmentDependencies: devDependencies,

      suggestedEntryFiles: entryFiles,
      suggestedSourceRoots: sourceRoots,
      suggestedTestRoots: testRoots,
    };
  }

  private extractDependencies(content: string, isKotlin: boolean): string[] {
    const deps = new Set<string>();
    const regex = new RegExp(
      isKotlin
        ? /(?:implementation|api|compileOnly|runtimeOnly)\s*\(\s*"([^"]+)"/g
        : /(?:implementation|api|compileOnly|runtimeOnly)\s*\(?\s*'([^']+)'/g,
    );
    let match;
    while ((match = regex.exec(content)) !== null) {
      deps.add(match[1]);
    }
    return [...deps].sort();
  }

  private extractDevDependencies(content: string, isKotlin: boolean): string[] {
    const deps = new Set<string>();
    const regex = new RegExp(
      isKotlin
        ? /(?:testImplementation|testCompileOnly|testRuntimeOnly)\s*\(\s*"([^"]+)"/g
        : /(?:testImplementation|testCompileOnly|testRuntimeOnly)\s*\(?\s*'([^']+)'/g,
    );
    let match;
    while ((match = regex.exec(content)) !== null) {
      deps.add(match[1]);
    }
    return [...deps].sort();
  }

  private findApplicationClasses(entries: ReadonlySet<string>): string[] {
    const candidates = [
      /src\/main\/java\/.*Application\.java$/,
      /src\/main\/kotlin\/.*Application\.kt$/,
    ];
    return [...entries].filter((f) => candidates.some((r) => r.test(f))).sort();
  }

  // ––– Path helpers (identical to Maven reader, extract later) –––
  private collectProjectEntryPaths(
    entries: readonly WorkspaceFileEntry[],
    relativeRoot: string,
  ): ReadonlySet<string> {
    const paths = new Set<string>();
    const normalizedRoot = this.normalizeProjectRoot(relativeRoot);
    for (const entry of entries) {
      const p = this.normalizeRelativePath(entry.relativePath);
      const projRel = this.relativeToProjectRoot(p, normalizedRoot);
      if (projRel !== null) paths.add(projRel);
    }
    return paths;
  }

  private detectExistingRoots(
    paths: ReadonlySet<string>,
    candidates: readonly string[],
  ): string[] {
    const roots: string[] = [];
    for (const candidate of candidates) {
      const prefix = candidate + "/";
      if ([...paths].some((p) => p === candidate || p.startsWith(prefix))) {
        roots.push(candidate);
      }
    }
    return roots.sort();
  }

  private normalizeRelativePath(value: string): string {
    let normalized = value
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\.\/+/, "");
    const result = path.posix.normalize(normalized);
    return result === "." ? "" : result.replace(/^\/+/, "");
  }

  private normalizeProjectRoot(value: string): string {
    const norm = this.normalizeRelativePath(value);
    return norm === "." ? "" : norm;
  }

  private relativeToProjectRoot(
    entryPath: string,
    root: string,
  ): string | null {
    if (!root) return entryPath;
    if (entryPath === root) return "";
    const prefix = root + "/";
    return entryPath.startsWith(prefix) ? entryPath.slice(prefix.length) : null;
  }
}
