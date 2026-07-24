import type { WorkspaceFileEntry, WorkspaceSnapshot } from "../workspace";

/**
 * PROJECT ECOSYSTEM
 *
 * Ecosystem identifiers remain extensible.
 *
 * Examples:
 * node, rust, go, python, java, dotnet
 */
export type ProjectEcosystemId = string;

/**
 * PROJECT CATALOG BUILD INPUT
 */

export interface ProjectCatalogBuildInput {
  snapshot: WorkspaceSnapshot;
}

/**
 * NORMALIZED MANIFEST INFORMATION
 *
 * Manifest readers return factual information only.
 * They do not classify project type or generate confidence scores.
 */
export interface ProjectManifestInfo {
  /**
   * Identifier of the reader that parsed the manifest.
   *
   * Example: package-json
   */
  readerId: string;

  /**
   * Ecosystem detected from the manifest format.
   *
   * Example: node
   */
  ecosystem: ProjectEcosystemId;

  /**
   * Workspace-relative directory containing the manifest.
   *
   * Empty string represents the workspace root.
   */
  relativeRoot: string;

  /**
   * Workspace-relative manifest paths.
   */
  manifestPaths: string[];

  declaredName?: string;
  declaredVersion?: string;

  scripts: Record<string, string>;

  /**
   * Runtime and production dependencies.
   */
  dependencies: string[];

  /**
   * Development-only dependencies.
   */
  developmentDependencies: string[];

  /**
   * Paths relative to this project root.
   *
   * ProjectCatalogBuilder converts these into canonical
   * workspace-relative paths.
   */
  suggestedEntryFiles: string[];
  suggestedSourceRoots: string[];
  suggestedTestRoots: string[];
}

/**
 * MANIFEST READERS
 */

export interface ManifestReaderInput {
  rootId: string;

  /**
   * Workspace-relative detected project root.
   */
  relativeRoot: string;

  manifest: WorkspaceFileEntry;

  /**
   * Files assigned to this detected project root.
   *
   * Files owned by nested projects should be excluded by
   * ProjectCatalogBuilder before invoking the reader.
   */
  projectEntries: readonly WorkspaceFileEntry[];
}

export interface ManifestReader {
  readonly id: string;
  readonly priority: number;

  supports(manifest: WorkspaceFileEntry): boolean;

  read(input: ManifestReaderInput): Promise<ProjectManifestInfo>;
}

/**
 * PROJECT DEFINITIONS
 */

export interface ProjectDefinition {
  /**
   * Deterministic identifier within this catalog.
   */
  id: string;

  /**
   * References WorkspaceRoot.id.
   */
  rootId: string;

  /**
   * Canonical workspace-relative project root.
   *
   * Empty string represents the workspace root.
   */
  relativeRoot: string;

  name: string;
  version?: string;

  ecosystems: ProjectEcosystemId[];

  /**
   * Canonical workspace-relative paths.
   */
  manifests: string[];
  entryFiles: string[];
  sourceRoots: string[];
  testRoots: string[];

  scripts: Record<string, string>;

  dependencies: string[];
  developmentDependencies: string[];
}

/**
 * PROJECT RELATIONSHIPS
 */

export type ProjectRelationshipType =
  | "workspace_member"
  | "depends_on"
  | "development_depends_on";

export interface ProjectRelationship {
  fromProjectId: string;
  toProjectId: string;
  type: ProjectRelationshipType;
}

/**
 * PROJECT CATALOG WARNINGS
 */

export type ProjectCatalogWarningCode =
  | "duplicate_manifest"
  | "manifest_path_invalid"
  | "unsupported_manifest"
  | "manifest_reader_not_found"
  | "manifest_reader_ambiguous"
  | "manifest_provider_path_missing"
  | "manifest_read_failed"
  | "manifest_invalid"
  | "project_name_missing"
  | "duplicate_project_id"
  | "nested_project_conflict";

export interface ProjectCatalogWarning {
  code: ProjectCatalogWarningCode;

  /**
   * Usually a workspace-relative manifest path.
   */
  path: string;

  message: string;
  readerId?: string;
}

/**
 * PROJECT CATALOG
 */

export type ProjectCatalogStatus = "complete" | "partial";

export interface ProjectCatalog {
  schemaVersion: 1;

  /**
   * References the WorkspaceSnapshot used to produce this catalog.
   */
  workspaceSnapshotId: string;

  projects: ProjectDefinition[];
  relationships: ProjectRelationship[];

  warnings: ProjectCatalogWarning[];
  status: ProjectCatalogStatus;

  generatedAt: string;
}

/**
 * PROJECT ROOT DETECTION
 */

export type ProjectManifestKind =
  | "package_json"
  | "cargo"
  | "go_module"
  | "python_pyproject"
  | "python_setup"
  | "python_requirements"
  | "maven"
  | "gradle"
  | "dotnet"
  | "composer"
  | "ruby"
  | "unknown";

export interface DetectedProjectManifest {
  kind: ProjectManifestKind;
  entry: WorkspaceFileEntry;
}

export interface DetectedProjectRoot {
  /**
   * Workspace root containing this project.
   */
  rootId: string;

  /**
   * Canonical workspace-relative directory containing
   * the detected manifests.
   *
   * Empty string represents the workspace root.
   */
  relativeRoot: string;

  /**
   * Recognized manifests located directly in this
   * project root.
   */
  manifests: DetectedProjectManifest[];
}

export type ProjectRootDetectionWarningCode =
  | "duplicate_manifest"
  | "manifest_path_invalid"
  | "unsupported_manifest";

export interface ProjectRootDetectionWarning {
  code: ProjectRootDetectionWarningCode;
  path: string;
  message: string;
}

export interface ProjectRootDetectionResult {
  roots: DetectedProjectRoot[];
  warnings: ProjectRootDetectionWarning[];
}

export interface ProjectRootDetectorOptions {
  /**
   * Additional exact manifest filenames.
   *
   * They are detected with manifest kind "unknown".
   */
  additionalManifestNames?: readonly string[];

  /**
   * Whether secondary manifests such as requirements.txt
   * can independently establish a project root.
   *
   * Defaults to false.
   */
  includeSecondaryManifests?: boolean;
}

/**
 * INTERNAL MANIFEST MATCHING
 */

export interface ManifestMatch {
  kind: ProjectManifestKind;

  /**
   * Lower values represent stronger manifest signals.
   */
  priority: number;

  /**
   * Secondary manifests normally supplement another manifest
   * instead of independently establishing a project root.
   */
  secondary: boolean;
}
