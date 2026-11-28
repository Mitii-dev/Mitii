import * as path from "node:path";

import type { WorkspaceFileEntry, WorkspaceSnapshot } from "../workspace";
import {
  DetectedProjectManifest,
  DetectedProjectRoot,
  ManifestMatch,
  ProjectManifestKind,
  ProjectRootDetectionResult,
  ProjectRootDetectionWarning,
  ProjectRootDetectorOptions,
} from "./types";
import { PROJECT_CATALOG_CONSTANTS } from "./constants";

export class ProjectRootDetector {
  private readonly additionalManifestNames: ReadonlySet<string>;

  private readonly includeSecondaryManifests: boolean;

  constructor(options: ProjectRootDetectorOptions = {}) {
    this.additionalManifestNames = new Set(
      (options.additionalManifestNames ?? []).map((name) =>
        name.trim().toLowerCase(),
      ),
    );

    this.includeSecondaryManifests = options.includeSecondaryManifests ?? false;
  }

  /**
   * Detects every potential project root in a workspace snapshot.
   *
   * Detection is based only on snapshot metadata. This class does not
   * read manifest contents, classify projects, or access the filesystem.
   */
  public detect(snapshot: WorkspaceSnapshot): ProjectRootDetectionResult {
    const warnings: ProjectRootDetectionWarning[] = [];

    const candidates = new Map<
      string,
      {
        rootId: string;
        relativeRoot: string;
        manifests: Map<string, DetectedProjectManifest>;
      }
    >();

    const files = snapshot.entries
      .filter((entry): entry is WorkspaceFileEntry => entry.kind === "file")
      .sort((left, right) => this.compareEntries(left, right));

    for (const file of files) {
      const normalizedPath = this.normalizeRelativePath(file.relativePath);

      if (normalizedPath === null) {
        warnings.push({
          code: "manifest_path_invalid",
          path: file.relativePath,
          message:
            `The workspace entry has an invalid relative path: ` +
            `"${file.relativePath}".`,
        });

        continue;
      }

      const fileName = path.posix.basename(normalizedPath).toLowerCase();

      const match = this.matchManifest(fileName);

      if (!match) {
        continue;
      }

      if (match.secondary && !this.includeSecondaryManifests) {
        continue;
      }

      const relativeRoot = this.dirname(normalizedPath);

      const candidateKey = this.createCandidateKey(file.rootId, relativeRoot);

      let candidate = candidates.get(candidateKey);

      if (!candidate) {
        candidate = {
          rootId: file.rootId,
          relativeRoot,
          manifests: new Map(),
        };

        candidates.set(candidateKey, candidate);
      }

      const manifestKey = normalizedPath.toLowerCase();

      if (candidate.manifests.has(manifestKey)) {
        warnings.push({
          code: "duplicate_manifest",
          path: normalizedPath,
          message:
            `The manifest "${normalizedPath}" appears more than ` +
            "once in the workspace snapshot.",
        });

        continue;
      }

      candidate.manifests.set(manifestKey, {
        kind: match.kind,
        entry: {
          ...file,
          relativePath: normalizedPath,
        },
      });
    }

    const roots = [...candidates.values()]
      .map(
        (candidate): DetectedProjectRoot => ({
          rootId: candidate.rootId,
          relativeRoot: candidate.relativeRoot,
          manifests: [...candidate.manifests.values()].sort((left, right) =>
            this.compareManifests(left, right),
          ),
        }),
      )
      .sort((left, right) => this.compareRoots(left, right));

    return {
      roots,
      warnings,
    };
  }

  private matchManifest(fileName: string): ManifestMatch | undefined {
    const exactMatch = PROJECT_CATALOG_CONSTANTS.EXACT_MANIFESTS[fileName];

    if (exactMatch) {
      return exactMatch;
    }

    /*
     * .NET projects use user-defined names:
     * Example.csproj, Example.fsproj, Example.vbproj.
     */
    if (
      fileName.endsWith(".csproj") ||
      fileName.endsWith(".fsproj") ||
      fileName.endsWith(".vbproj")
    ) {
      return {
        kind: "dotnet",
        priority: 10,
        secondary: false,
      };
    }

    if (this.additionalManifestNames.has(fileName)) {
      return {
        kind: "unknown",
        priority: 100,
        secondary: false,
      };
    }

    return undefined;
  }

  private normalizeRelativePath(relativePath: string): string | null {
    const normalized = relativePath
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\.\/+/, "")
      .replace(/\/+/g, "/");

    if (!normalized) {
      return null;
    }

    if (normalized.startsWith("/")) {
      return null;
    }

    const segments = normalized.split("/");

    if (
      segments.some(
        (segment) => !segment || segment === "." || segment === "..",
      )
    ) {
      return null;
    }

    return segments.join("/");
  }

  private dirname(relativePath: string): string {
    const directory = path.posix.dirname(relativePath);

    return directory === "." ? "" : directory;
  }

  private createCandidateKey(rootId: string, relativeRoot: string): string {
    return `${rootId}\u0000${relativeRoot}`;
  }

  private compareEntries(
    left: WorkspaceFileEntry,
    right: WorkspaceFileEntry,
  ): number {
    const rootComparison = left.rootId.localeCompare(right.rootId);

    if (rootComparison !== 0) {
      return rootComparison;
    }

    return left.relativePath.localeCompare(right.relativePath);
  }

  private compareManifests(
    left: DetectedProjectManifest,
    right: DetectedProjectManifest,
  ): number {
    const leftPriority = this.getManifestPriority(left.kind);

    const rightPriority = this.getManifestPriority(right.kind);

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return left.entry.relativePath.localeCompare(right.entry.relativePath);
  }

  private getManifestPriority(kind: ProjectManifestKind): number {
    const match = Object.values(PROJECT_CATALOG_CONSTANTS.EXACT_MANIFESTS).find(
      (definition) => definition.kind === kind,
    );

    if (match) {
      return match.priority;
    }

    if (kind === "dotnet") {
      return 10;
    }

    return 100;
  }

  private compareRoots(
    left: DetectedProjectRoot,
    right: DetectedProjectRoot,
  ): number {
    const rootComparison = left.rootId.localeCompare(right.rootId);

    if (rootComparison !== 0) {
      return rootComparison;
    }

    /*
     * Parent projects sort before nested projects.
     */
    const depthComparison =
      this.pathDepth(left.relativeRoot) - this.pathDepth(right.relativeRoot);

    if (depthComparison !== 0) {
      return depthComparison;
    }

    return left.relativeRoot.localeCompare(right.relativeRoot);
  }

  private pathDepth(relativePath: string): number {
    if (!relativePath) {
      return 0;
    }

    return relativePath.split("/").length;
  }
}
