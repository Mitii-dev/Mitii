import * as path from "node:path";

import type { FileSystemReadPort } from "../../../shared";
import type { WorkspaceFileEntry } from "../../../workspace";
import type {
  ManifestReader,
  ManifestReaderInput,
  ProjectManifestInfo,
} from "../../types";

export interface GoModuleReaderOptions {
  maximumBytes?: number; // default 1 MiB
}

const DEFAULT_MAXIMUM_BYTES = 1024 * 1024;

const COMMON_SOURCE_ROOTS = ["cmd", "internal", "pkg"];
const COMMON_TEST_ROOTS: readonly string[] = []; // tests are alongside code in Go

export class GoModuleReader implements ManifestReader {
  public readonly id = "go-mod";
  public readonly priority = 10;

  private readonly maximumBytes: number;

  constructor(
    private readonly fileSystem: FileSystemReadPort,
    options: GoModuleReaderOptions = {},
  ) {
    this.maximumBytes = options.maximumBytes ?? DEFAULT_MAXIMUM_BYTES;
    if (!Number.isSafeInteger(this.maximumBytes) || this.maximumBytes <= 0) {
      throw new RangeError("maximumBytes must be a positive safe integer.");
    }
  }

  public supports(manifest: WorkspaceFileEntry): boolean {
    return (
      path.posix
        .basename(this.normalizeRelativePath(manifest.relativePath))
        .toLowerCase() === "go.mod"
    );
  }

  public async read(input: ManifestReaderInput): Promise<ProjectManifestInfo> {
    if (!this.supports(input.manifest)) {
      throw new Error(
        `GoModuleReader does not support "${input.manifest.relativePath}".`,
      );
    }

    const providerPath = input.manifest.providerPath;
    if (!providerPath) {
      throw new Error(
        `Cannot read go.mod "${input.manifest.relativePath}" — no providerPath.`,
      );
    }

    const content = await this.fileSystem.readText(providerPath, {
      encoding: "utf8",
      maximumBytes: this.maximumBytes,
    });

    const { modulePath, requires } = this.parseGoMod(
      content,
      input.manifest.relativePath,
    );

    const scripts: Record<string, string> = {
      build: "go build ./...",
      test: "go test ./...",
    };

    const projectEntryPaths = this.collectProjectEntryPaths(
      input.projectEntries,
      input.relativeRoot,
    );

    const sourceRoots = this.detectExistingRoots(
      projectEntryPaths,
      COMMON_SOURCE_ROOTS,
    );
    const testRoots = this.detectExistingRoots(
      projectEntryPaths,
      COMMON_TEST_ROOTS,
    );

    // In Go, the "entry point" is typically the package main inside cmd/<name>/main.go
    const entryFiles = [...projectEntryPaths].filter(
      (f) => f.match(/cmd\/[^/]+\/main\.go$/) || f === "main.go",
    );

    return {
      readerId: this.id,
      ecosystem: "go",

      relativeRoot: input.relativeRoot,
      manifestPaths: [this.normalizeRelativePath(input.manifest.relativePath)],

      ...this.optionalString("declaredName", modulePath),

      scripts,
      dependencies: requires.map((r) => r.path).sort(),
      developmentDependencies: [], // go.mod does not distinguish dev deps

      suggestedEntryFiles: entryFiles.sort(),
      suggestedSourceRoots: sourceRoots,
      suggestedTestRoots: testRoots,
    };
  }

  private parseGoMod(
    content: string,
    relativePath: string,
  ): {
    modulePath: string;
    goVersion: string;
    requires: { path: string; version: string }[];
  } {
    const lines = content.split(/\r?\n/);
    let modulePath = "";
    let goVersion = "";
    const requires: { path: string; version: string }[] = [];
    let inRequireBlock = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line === "" || line.startsWith("//")) continue;

      if (line.startsWith("module ")) {
        modulePath = line.slice(7).trim();
      } else if (line.startsWith("go ")) {
        goVersion = line.slice(3).trim();
      } else if (line === "require (") {
        inRequireBlock = true;
      } else if (line === ")") {
        inRequireBlock = false;
      } else if (line.startsWith("require ")) {
        const parts = line.slice(8).trim().split(/\s+/);
        if (parts.length >= 2) {
          requires.push({ path: parts[0], version: parts[1] });
        }
      } else if (inRequireBlock) {
        const parts = line.split(/\s+/);
        if (parts.length >= 2) {
          requires.push({ path: parts[0], version: parts[1] });
        }
      }
    }

    if (!modulePath) {
      throw new Error(
        `go.mod "${relativePath}" is missing a module declaration.`,
      );
    }

    return { modulePath, goVersion, requires };
  }

  // ––– Path helpers (identical, extract later) –––
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

  private optionalString(
    key: string,
    value: unknown,
  ): Partial<Record<string, string>> {
    return typeof value === "string" && value.trim()
      ? { [key]: value.trim() }
      : {};
  }
}
