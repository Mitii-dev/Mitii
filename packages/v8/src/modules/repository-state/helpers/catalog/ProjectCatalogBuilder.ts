import type { WorkspaceFileEntry, WorkspaceSnapshot } from "../workspace";

import { extractProjectRelationships } from "./extractProjectRelationships";
import { ProjectRootDetector } from "./ProjectRootDetector";
import { ManifestReaderRegistry } from "./manifests";
import { projectCatalogSchema } from "./schema";
import {
  compareWorkspaceFiles,
  createFallbackProjectName,
  errorMessage,
  firstDeclaredValue,
  isWithinRelativeRoot,
  mergeScripts,
  normalizeRelativePath,
  normalizeRelativeRoot,
  pathDepth,
  resolveWorkspacePaths,
  slug,
  sortProjects,
  sortWarnings,
  uniqueSorted,
} from "./ProjectCatalogHelpers";

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
      .sort((left, right) => compareWorkspaceFiles(left, right));

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

    sortProjects(projects);

    const relationships = extractProjectRelationships({
      projects,
      warnings,
    });
    sortWarnings(warnings);

    const catalog: ProjectCatalog = {
      schemaVersion: 1,

      workspaceSnapshotId: snapshot.snapshotId,

      projects,

      relationships,

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
          isWithinRelativeRoot(
            candidate.relativeRoot,
            projectRoot.relativeRoot,
          ),
      )
      .map((candidate) => normalizeRelativeRoot(candidate.relativeRoot))
      .sort((left, right) => {
        const depthDifference = pathDepth(left) - pathDepth(right);

        if (depthDifference !== 0) {
          return depthDifference;
        }

        return left.localeCompare(right);
      });

    return files.filter((file) => {
      if (file.rootId !== projectRoot.rootId) {
        return false;
      }

      const filePath = normalizeRelativePath(file.relativePath);

      if (!isWithinRelativeRoot(filePath, projectRoot.relativeRoot)) {
        return false;
      }

      return !nestedRoots.some((nestedRoot) =>
        isWithinRelativeRoot(filePath, nestedRoot),
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
            errorMessage(error),
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
      normalizeRelativeRoot(info.relativeRoot) !==
      normalizeRelativeRoot(projectRoot.relativeRoot)
    ) {
      throw new Error(
        `Reader returned relativeRoot ` +
          `"${info.relativeRoot}" instead of ` +
          `"${projectRoot.relativeRoot}".`,
      );
    }

    const normalizedManifestPath = normalizeRelativePath(
      manifest.relativePath,
    );

    const returnedManifestPaths = new Set(
      info.manifestPaths.map((value) => normalizeRelativePath(value)),
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
    const declaredName = firstDeclaredValue(
      manifestInfos,
      (info) => info.declaredName,
    );

    const fallbackName = createFallbackProjectName(projectRoot, snapshot);

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

    const declaredVersion = firstDeclaredValue(
      manifestInfos,
      (info) => info.declaredVersion,
    );

    const ecosystems = uniqueSorted(
      manifestInfos.map((info) => info.ecosystem),
    );

    const manifests = uniqueSorted(
      manifestInfos.flatMap((info) => info.manifestPaths),
    );

    const entryFiles = resolveWorkspacePaths(
      projectRoot.relativeRoot,
      manifestInfos.flatMap((info) => info.suggestedEntryFiles),
    );

    const sourceRoots = resolveWorkspacePaths(
      projectRoot.relativeRoot,
      manifestInfos.flatMap((info) => info.suggestedSourceRoots),
    );

    const testRoots = resolveWorkspacePaths(
      projectRoot.relativeRoot,
      manifestInfos.flatMap((info) => info.suggestedTestRoots),
    );

    const scripts = mergeScripts(manifestInfos);

    const dependencies = uniqueSorted(
      manifestInfos.flatMap((info) => info.dependencies),
    );

    const developmentDependencies = uniqueSorted(
      manifestInfos.flatMap((info) => info.developmentDependencies),
    );

    const workspaceMemberPatterns = uniqueSorted(
      manifestInfos.flatMap((info) => info.workspaceMemberPatterns ?? []),
    );

    return {
      id: projectId,

      rootId: projectRoot.rootId,

      relativeRoot: normalizeRelativeRoot(projectRoot.relativeRoot),

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

      ...(workspaceMemberPatterns.length > 0
        ? { workspaceMemberPatterns }
        : {}),
    };
  }

  private createUniqueProjectId(
    projectRoot: DetectedProjectRoot,
    name: string,
    usedProjectIds: Set<string>,
    warnings: ProjectCatalogWarning[],
  ): string {
    const rootPart = slug(projectRoot.rootId);

    const pathPart = projectRoot.relativeRoot
      ? slug(projectRoot.relativeRoot)
      : "root";

    const namePart = slug(name);

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
}
