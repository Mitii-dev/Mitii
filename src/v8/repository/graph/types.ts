import type { ProjectCatalog } from "../catalog";
import type { CodeIndexFile, CodeIndexReadPort } from "../code-index";
import type { WorkspaceSnapshot } from "../workspace";

/**
 * GRAPH NODES
 */

export type RepoGraphNodeKind = "project" | "file" | "symbol";

export interface RepoGraphNodeBase {
  id: string;
  kind: RepoGraphNodeKind;
}

export interface RepoGraphProjectNode extends RepoGraphNodeBase {
  kind: "project";

  projectId: string;

  rootId: string;
  relativeRoot: string;

  name: string;
  ecosystems: string[];
}

export interface RepoGraphFileNode extends RepoGraphNodeBase {
  kind: "file";

  fileId: string;

  rootId: string;
  relativePath: string;

  projectId?: string;
  language?: string;

  size?: number;
  modifiedAt?: string;
  contentHash?: string;
}

export interface RepoGraphSymbolNode extends RepoGraphNodeBase {
  kind: "symbol";

  symbolId: string;
  fileId: string;

  name: string;
  symbolKind: string;

  exported?: boolean;
  signature?: string;

  startLine?: number;
  endLine?: number;
}

export type RepoGraphNode =
  | RepoGraphProjectNode
  | RepoGraphFileNode
  | RepoGraphSymbolNode;

/**
 * GRAPH EDGES
 */

export type RepoGraphEdgeType =
  | "contains"
  | "declares"
  | "imports"
  | "references"
  | "workspace_member"
  | "depends_on"
  | "development_depends_on";

export interface RepoGraphEdgeEvidence {
  source:
    | "project_catalog"
    | "code_index_import"
    | "code_index_reference"
    | "code_index_symbol";

  detail?: string;
}

export interface RepoGraphEdge {
  id: string;

  type: RepoGraphEdgeType;

  fromNodeId: string;
  toNodeId: string;

  /**
   * Number of equivalent relationships represented by this edge.
   */
  weight: number;

  evidence: RepoGraphEdgeEvidence[];
}

/**
 * BUILDER
 */

export interface RepoGraphBuilderOptions {
  maximumFiles?: number;
  maximumSymbolsPerFile?: number;
  maximumEdges?: number;
  maximumEvidencePerEdge?: number;
  maximumConsistencyRetries?: number;
}

export interface RepoGraphBuildInput {
  snapshot: WorkspaceSnapshot;
  catalog: ProjectCatalog;

  /**
   * Restricts the graph to selected workspace roots.
   */
  rootIds?: readonly string[];

  abortSignal?: AbortSignal;
}

export type RepoGraphStatus = "complete" | "partial";

export type RepoGraphWarningCode =
  | "maximum_files_reached"
  | "maximum_edges_reached"
  | "code_index_changed_during_build"
  | "project_relationship_target_missing";

export interface RepoGraphWarning {
  code: RepoGraphWarningCode;
  message: string;

  nodeId?: string;
  path?: string;
}

/**
 * STATISTICS
 */

export interface RepoGraphStatistics {
  availableFiles: number;
  indexedFiles: number;

  projectNodes: number;
  fileNodes: number;
  symbolNodes: number;

  containsEdges: number;
  declaresEdges: number;
  importEdges: number;
  referenceEdges: number;
  projectRelationshipEdges: number;

  /**
   * Imports that did not resolve to a file in the Code Index.
   */
  unresolvedImports: number;

  /**
   * Resolved import targets that were outside the bounded graph.
   */
  omittedImportTargets: number;

  /**
   * References whose targets were not included in the bounded graph.
   */
  omittedReferenceTargets: number;

  consistencyRetries: number;

  durationMs: number;
}

/**
 * OUTPUT
 */

export interface RepoGraph {
  schemaVersion: 1;

  workspaceSnapshotId: string;
  codeIndexChangeToken: string;

  nodes: RepoGraphNode[];
  edges: RepoGraphEdge[];

  warnings: RepoGraphWarning[];
  statistics: RepoGraphStatistics;

  status: RepoGraphStatus;

  generatedAt: string;
}

/**
 * INTERNAL BUILDER RESULT
 *
 * This represents one build attempt before the Code Index
 * consistency token is checked again.
 */

export interface RepoGraphBuildAttempt {
  nodes: RepoGraphNode[];
  edges: RepoGraphEdge[];

  warnings: RepoGraphWarning[];

  fileResult: {
    files: readonly CodeIndexFile[];
    totalAvailable: number;
    truncated: boolean;
  };

  unresolvedImports: number;
  omittedImportTargets: number;
  omittedReferenceTargets: number;

  edgesTruncated: boolean;
}

/**
 * BUILDER DEPENDENCIES
 */

export interface RepoGraphBuilderDependencies {
  codeIndex: CodeIndexReadPort;
}
