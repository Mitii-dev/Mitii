import * as path from "node:path";

import type { WorkspaceFileEntry, WorkspaceSnapshot } from "../workspace";

import { ProjectRootDetector } from "./ProjectRootDetector";
import { ManifestReaderRegistry } from "./manifests";
import { projectCatalogSchema } from "./schema";

import type {
  DetectedProjectRoot,
  ManifestReader,
  ProjectCatalog,
  ProjectCatalogBuildInput,
  ProjectCatalogWarning,
  ProjectDefinition,
  ProjectManifestInfo,
} from "./types";

export class ProjectCatalogBuilder {
  constructor(
    private readonly rootDetector: ProjectRootDetector,
    private readonly readerRegistry: ManifestReaderRegistry,
  ) {}

  public async build(input: ProjectCatalogBuildInput): Promise<ProjectCatalog> {
    const { snapshot } = input;

    const detection = this.rootDetector.detect(snapshot);

    const warnings: ProjectCatalogWarning[] = detection.warnings.map(
      (warning): ProjectCatalogWarning => ({
        code: warning.code,
        path: warning.path,
        message: warning.message,
      }),
    );

    const files = snapshot.entries
      .filter((entry): entry is WorkspaceFileEntry => entry.kind === "file")
      .sort((left, right) => this.compareWorkspaceFiles(left, right));

    const projects: ProjectDefinition[] = [];
    const usedProjectIds = new Set<string>();

    for (const detectedRoot of detection.roots) {
      const projectEntries = this.collectProjectEntries(
        detectedRoot,
        detection.roots,
        files,
      );

      const manifestInfos = await this.readProjectManifests(
        detectedRoot,
        projectEntries,
        warnings,
      );

      if (manifestInfos.length === 0) {
        continue;
      }

      const project = this.buildProjectDefinition(
        detectedRoot,
        manifestInfos,
        snapshot,
        usedProjectIds,
        warnings,
      );

      projects.push(project);
    }

    this.sortProjects(projects);
    this.sortWarnings(warnings);

    const catalog: ProjectCatalog = {
      schemaVersion: 1,

      workspaceSnapshotId: snapshot.snapshotId,

      projects,

      /*
       * Relationship extraction is intentionally deferred.
       *
       * It will later use factual workspace declarations and
       * dependency resolution rather than path guesses.
       */
      relationships: [],

      warnings,

      status:
        warnings.length > 0 || snapshot.status !== "complete"
          ? "partial"
          : "complete",

      generatedAt: new Date().toISOString(),
    };

    return projectCatalogSchema.parse(catalog) as ProjectCatalog;
  }

  /**
   * Assigns files to the closest detected project root.
   *
   * Files belonging to nested detected projects are excluded from
   * the parent project.
   */
  private collectProjectEntries(
    projectRoot: DetectedProjectRoot,
    allProjectRoots: readonly DetectedProjectRoot[],
    files: readonly WorkspaceFileEntry[],
  ): WorkspaceFileEntry[] {
    const nestedRoots = allProjectRoots
      .filter(
        (candidate) =>
          candidate.rootId === projectRoot.rootId &&
          candidate.relativeRoot !== projectRoot.relativeRoot &&
          this.isWithinRelativeRoot(
            candidate.relativeRoot,
            projectRoot.relativeRoot,
          ),
      )
      .map((candidate) => this.normalizeRelativeRoot(candidate.relativeRoot))
      .sort((left, right) => {
        const depthDifference = this.pathDepth(left) - this.pathDepth(right);

        if (depthDifference !== 0) {
          return depthDifference;
        }

        return left.localeCompare(right);
      });

    return files.filter((file) => {
      if (file.rootId !== projectRoot.rootId) {
        return false;
      }

      const filePath = this.normalizeRelativePath(file.relativePath);

      if (!this.isWithinRelativeRoot(filePath, projectRoot.relativeRoot)) {
        return false;
      }

      return !nestedRoots.some((nestedRoot) =>
        this.isWithinRelativeRoot(filePath, nestedRoot),
      );
    });
  }

  private async readProjectManifests(
    projectRoot: DetectedProjectRoot,
    projectEntries: readonly WorkspaceFileEntry[],
    warnings: ProjectCatalogWarning[],
  ): Promise<ProjectManifestInfo[]> {
    const manifestInfos: ProjectManifestInfo[] = [];

    const manifests = [...projectRoot.manifests].sort((left, right) =>
      left.entry.relativePath.localeCompare(right.entry.relativePath),
    );

    for (const detectedManifest of manifests) {
      const manifest = detectedManifest.entry;

      if (!manifest.providerPath) {
        warnings.push({
          code: "manifest_provider_path_missing",
          path: manifest.relativePath,
          message:
            `Manifest "${manifest.relativePath}" ` +
            "cannot be read because providerPath is missing.",
        });

        continue;
      }

      const resolution = this.readerRegistry.resolve(manifest);

      if (resolution.status === "not_found") {
        warnings.push({
          code: "manifest_reader_not_found",
          path: manifest.relativePath,
          message:
            `No registered manifest reader supports ` +
            `"${manifest.relativePath}".`,
        });

        continue;
      }

      if (resolution.status === "ambiguous") {
        warnings.push({
          code: "manifest_reader_ambiguous",
          path: manifest.relativePath,
          message:
            `Multiple manifest readers with the same priority ` +
            `support "${manifest.relativePath}".`,
        });

        continue;
      }

      /*
       * Explicitly guard the optional property.
       *
       * This is required because ManifestReaderResolution currently
       * allows reader to be undefined even when status is "resolved".
       */
      const reader = resolution.reader;

      if (!reader) {
        warnings.push({
          code: "manifest_reader_not_found",
          path: manifest.relativePath,
          message:
            `Manifest reader resolution returned status ` +
            `"${resolution.status}" without a reader for ` +
            `"${manifest.relativePath}".`,
        });

        continue;
      }

      try {
        const info = await reader.read({
          rootId: projectRoot.rootId,
          relativeRoot: projectRoot.relativeRoot,
          manifest,
          projectEntries,
        });

        this.validateManifestInfo(info, reader, projectRoot, manifest);

        manifestInfos.push(info);
      } catch (error) {
        warnings.push({
          code: "manifest_read_failed",
          path: manifest.relativePath,
          readerId: reader.id,
          message:
            `Reader "${reader.id}" failed to read ` +
            `"${manifest.relativePath}": ` +
            this.errorMessage(error),
        });
      }
    }

    return manifestInfos.sort((left, right) => {
      const ecosystemComparison = left.ecosystem.localeCompare(right.ecosystem);

      if (ecosystemComparison !== 0) {
        return ecosystemComparison;
      }

      return left.readerId.localeCompare(right.readerId);
    });
  }

  private validateManifestInfo(
    info: ProjectManifestInfo,
    reader: ManifestReader,
    projectRoot: DetectedProjectRoot,
    manifest: WorkspaceFileEntry,
  ): void {
    if (info.readerId !== reader.id) {
      throw new Error(
        `Reader returned readerId "${info.readerId}" ` +
          `instead of "${reader.id}".`,
      );
    }

    if (!info.ecosystem.trim()) {
      throw new Error("Reader returned an empty ecosystem identifier.");
    }

    if (
      this.normalizeRelativeRoot(info.relativeRoot) !==
      this.normalizeRelativeRoot(projectRoot.relativeRoot)
    ) {
      throw new Error(
        `Reader returned relativeRoot ` +
          `"${info.relativeRoot}" instead of ` +
          `"${projectRoot.relativeRoot}".`,
      );
    }

    const normalizedManifestPath = this.normalizeRelativePath(
      manifest.relativePath,
    );

    const returnedManifestPaths = new Set(
      info.manifestPaths.map((value) => this.normalizeRelativePath(value)),
    );

    if (!returnedManifestPaths.has(normalizedManifestPath)) {
      throw new Error(
        `Reader output does not include its source ` +
          `manifest "${normalizedManifestPath}".`,
      );
    }
  }

  private buildProjectDefinition(
    projectRoot: DetectedProjectRoot,
    manifestInfos: readonly ProjectManifestInfo[],
    snapshot: WorkspaceSnapshot,
    usedProjectIds: Set<string>,
    warnings: ProjectCatalogWarning[],
  ): ProjectDefinition {
    const declaredName = this.firstDeclaredValue(
      manifestInfos,
      (info) => info.declaredName,
    );

    const fallbackName = this.createFallbackProjectName(projectRoot, snapshot);

    if (!declaredName) {
      warnings.push({
        code: "project_name_missing",
        path: projectRoot.relativeRoot,
        message:
          `No manifest declared a project name. ` + `Using "${fallbackName}".`,
      });
    }

    const name = declaredName ?? fallbackName;

    const projectId = this.createUniqueProjectId(
      projectRoot,
      name,
      usedProjectIds,
      warnings,
    );

    const declaredVersion = this.firstDeclaredValue(
      manifestInfos,
      (info) => info.declaredVersion,
    );

    const ecosystems = this.uniqueSorted(
      manifestInfos.map((info) => info.ecosystem),
    );

    const manifests = this.uniqueSorted(
      manifestInfos.flatMap((info) => info.manifestPaths),
    );

    const entryFiles = this.resolveWorkspacePaths(
      projectRoot.relativeRoot,
      manifestInfos.flatMap((info) => info.suggestedEntryFiles),
    );

    const sourceRoots = this.resolveWorkspacePaths(
      projectRoot.relativeRoot,
      manifestInfos.flatMap((info) => info.suggestedSourceRoots),
    );

    const testRoots = this.resolveWorkspacePaths(
      projectRoot.relativeRoot,
      manifestInfos.flatMap((info) => info.suggestedTestRoots),
    );

    const scripts = this.mergeScripts(manifestInfos);

    const dependencies = this.uniqueSorted(
      manifestInfos.flatMap((info) => info.dependencies),
    );

    const developmentDependencies = this.uniqueSorted(
      manifestInfos.flatMap((info) => info.developmentDependencies),
    );

    return {
      id: projectId,

      rootId: projectRoot.rootId,

      relativeRoot: this.normalizeRelativeRoot(projectRoot.relativeRoot),

      name,

      ...(declaredVersion
        ? {
            version: declaredVersion,
          }
        : {}),

      ecosystems,

      manifests,
      entryFiles,
      sourceRoots,
      testRoots,

      scripts,

      dependencies,
      developmentDependencies,
    };
  }

  private mergeScripts(
    manifestInfos: readonly ProjectManifestInfo[],
  ): Record<string, string> {
    const scripts: Record<string, string> = {};

    for (const info of manifestInfos) {
      const entries = Object.entries(info.scripts).sort(([left], [right]) =>
        left.localeCompare(right),
      );

      for (const [name, command] of entries) {
        if (scripts[name] === undefined) {
          scripts[name] = command;
          continue;
        }

        if (scripts[name] === command) {
          continue;
        }

        /*
         * Preserve both factual script definitions when different
         * ecosystems expose the same script name.
         */
        const qualifiedName = `${info.ecosystem}:${name}`;

        scripts[qualifiedName] = command;
      }
    }

    return Object.fromEntries(
      Object.entries(scripts).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
  }

  private createUniqueProjectId(
    projectRoot: DetectedProjectRoot,
    name: string,
    usedProjectIds: Set<string>,
    warnings: ProjectCatalogWarning[],
  ): string {
    const rootPart = this.slug(projectRoot.rootId);

    const pathPart = projectRoot.relativeRoot
      ? this.slug(projectRoot.relativeRoot)
      : "root";

    const namePart = this.slug(name);

    const baseId = [rootPart, pathPart, namePart].filter(Boolean).join(":");

    let candidate = baseId || "project";

    let suffix = 2;

    while (usedProjectIds.has(candidate)) {
      candidate = `${baseId}-${suffix}`;
      suffix += 1;
    }

    if (candidate !== baseId) {
      warnings.push({
        code: "duplicate_project_id",
        path: projectRoot.relativeRoot,
        message:
          `Generated project ID "${baseId}" was already ` +
          `used. Assigned "${candidate}" instead.`,
      });
    }

    usedProjectIds.add(candidate);

    return candidate;
  }

  private createFallbackProjectName(
    projectRoot: DetectedProjectRoot,
    snapshot: WorkspaceSnapshot,
  ): string {
    if (projectRoot.relativeRoot) {
      const basename = path.posix.basename(projectRoot.relativeRoot);

      if (basename) {
        return basename;
      }
    }

    const workspaceRoot = snapshot.roots.find(
      (root) => root.id === projectRoot.rootId,
    );

    return workspaceRoot?.name || projectRoot.rootId || "project";
  }

  private resolveWorkspacePaths(
    relativeRoot: string,
    projectRelativePaths: readonly string[],
  ): string[] {
    return this.uniqueSorted(
      projectRelativePaths.map((projectRelativePath) =>
        this.joinRelativePath(relativeRoot, projectRelativePath),
      ),
    );
  }

  private joinRelativePath(
    relativeRoot: string,
    projectRelativePath: string,
  ): string {
    const normalizedRoot = this.normalizeRelativeRoot(relativeRoot);

    const normalizedPath = this.normalizeRelativePath(projectRelativePath);

    if (!normalizedRoot) {
      return normalizedPath;
    }

    if (!normalizedPath) {
      return normalizedRoot;
    }

    /*
     * Avoid duplicating a root if a reader already returned a
     * workspace-relative path.
     */
    if (
      normalizedPath === normalizedRoot ||
      normalizedPath.startsWith(`${normalizedRoot}/`)
    ) {
      return normalizedPath;
    }

    return `${normalizedRoot}/${normalizedPath}`;
  }

  private firstDeclaredValue(
    infos: readonly ProjectManifestInfo[],
    selector: (info: ProjectManifestInfo) => string | undefined,
  ): string | undefined {
    for (const info of infos) {
      const value = selector(info)?.trim();

      if (value) {
        return value;
      }
    }

    return undefined;
  }

  private isWithinRelativeRoot(
    candidatePath: string,
    relativeRoot: string,
  ): boolean {
    const normalizedCandidate = this.normalizeRelativePath(candidatePath);

    const normalizedRoot = this.normalizeRelativeRoot(relativeRoot);

    if (!normalizedRoot) {
      return true;
    }

    return (
      normalizedCandidate === normalizedRoot ||
      normalizedCandidate.startsWith(`${normalizedRoot}/`)
    );
  }

  private normalizeRelativeRoot(value: string): string {
    if (!value.trim()) {
      return "";
    }

    return this.normalizeRelativePath(value);
  }

  private normalizeRelativePath(value: string): string {
    const normalized = value
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\.\/+/, "")
      .replace(/\/+/g, "/");

    const result = path.posix.normalize(normalized);

    if (result === ".") {
      return "";
    }

    return result.replace(/^\/+/, "");
  }

  private pathDepth(relativePath: string): number {
    const normalized = this.normalizeRelativeRoot(relativePath);

    return normalized ? normalized.split("/").length : 0;
  }

  private uniqueSorted(values: readonly string[]): string[] {
    return [
      ...new Set(values.map((value) => value.trim()).filter(Boolean)),
    ].sort((left, right) => left.localeCompare(right));
  }

  private slug(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/\\/g, "/")
      .replace(/[^a-z0-9._/-]+/g, "-")
      .replace(/[\/]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  private compareWorkspaceFiles(
    left: WorkspaceFileEntry,
    right: WorkspaceFileEntry,
  ): number {
    const rootComparison = left.rootId.localeCompare(right.rootId);

    if (rootComparison !== 0) {
      return rootComparison;
    }

    return left.relativePath.localeCompare(right.relativePath);
  }

  private sortProjects(projects: ProjectDefinition[]): void {
    projects.sort((left, right) => {
      const rootComparison = left.rootId.localeCompare(right.rootId);

      if (rootComparison !== 0) {
        return rootComparison;
      }

      return left.relativeRoot.localeCompare(right.relativeRoot);
    });
  }

  private sortWarnings(warnings: ProjectCatalogWarning[]): void {
    warnings.sort((left, right) => {
      const pathComparison = left.path.localeCompare(right.path);

      if (pathComparison !== 0) {
        return pathComparison;
      }

      return left.code.localeCompare(right.code);
    });
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }
}
