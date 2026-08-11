import type {
  ProjectCatalog,
} from "../catalog/types";

import type {
  CodeIndexFile,
  CodeIndexReadPort,
} from "../code-index/types";

import type {
  WorkspaceSnapshot,
} from "../workspace/types";

/**
 * NODES
 */

export type RepoGraphNodeKind =
  | "project"
  | "file"
  | "symbol";

export interface RepoGraphNodeBase {
  id: string;
  kind: RepoGraphNodeKind;
}

export interface RepoGraphProjectNode
  extends RepoGraphNodeBase {
  kind: "project";
  projectId: string;
  rootId: string;
  relativeRoot: string;
  name: string;
  ecosystems: string[];
}

export interface RepoGraphFileNode
  extends RepoGraphNodeBase {
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

export interface RepoGraphSymbolNode
  extends RepoGraphNodeBase {
  kind: "symbol";
  symbolId: string;
  fileId: string;
  parentSymbolId?: string;
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
 * EDGES
 */

export type RepoGraphEdgeType =
  | "contains"
  | "declares"
  | "imports"
  | "calls"
  | "references"
  | "workspace_member"
  | "depends_on"
  | "development_depends_on";

export type RepoGraphEdgeEvidenceSource =
  | "project_catalog"
  | "code_index_import"
  | "code_index_reference"
  | "code_index_symbol";

export interface RepoGraphEdgeEvidence {
  source: RepoGraphEdgeEvidenceSource;
  detail?: string;
  line?: number;
}

export interface RepoGraphEdge {
  id: string;
  type: RepoGraphEdgeType;
  fromNodeId: string;
  toNodeId: string;
  weight: number;
  evidenceCount: number;
  evidence: RepoGraphEdgeEvidence[];
  evidenceTruncated: boolean;
}

export interface RepoGraphEdgeInput {
  type: RepoGraphEdgeType;
  fromNodeId: string;
  toNodeId: string;
  evidence: RepoGraphEdgeEvidence;
}

export interface RepoGraphEdgeAccumulatorOptions {
  maximumEdges: number;
  maximumEvidencePerEdge: number;
}

export interface RepoGraphEdgeAccumulatorResult {
  edges: RepoGraphEdge[];
  droppedEdges: number;
  truncated: boolean;
}

/**
 * BUILD
 */

export interface RepoGraphBuilderOptions {
  maximumFiles?: number;
  maximumSymbolsPerFile?: number;
  maximumSymbolNodes?: number;
  maximumNodes?: number;
  maximumEdges?: number;
  maximumEvidencePerEdge?: number;
  symbolBatchSize?: number;
  graphBatchSize?: number;
  maximumConsistencyRetries?: number;
}

export interface RepoGraphBuildInput {
  snapshot: WorkspaceSnapshot;
  catalog: ProjectCatalog;
  rootIds?: readonly string[];
  abortSignal?: AbortSignal;
}

export type RepoGraphStatus =
  | "complete"
  | "partial";

export type RepoGraphWarningCode =
  | "maximum_files_reached"
  | "maximum_nodes_reached"
  | "maximum_symbol_nodes_reached"
  | "maximum_edges_reached"
  | "symbols_truncated"
  | "code_index_changed_during_build"
  | "project_relationship_target_missing";

export interface RepoGraphWarning {
  code: RepoGraphWarningCode;
  message: string;
  nodeId?: string;
  path?: string;
}

export interface RepoGraphStatistics {
  availableFiles: number;
  indexedFiles: number;
  projectNodes: number;
  fileNodes: number;
  symbolNodes: number;
  containsEdges: number;
  declaresEdges: number;
  importEdges: number;
  callEdges: number;
  referenceEdges: number;
  projectRelationshipEdges: number;
  unresolvedImports: number;
  omittedImportTargets: number;
  ambiguousReferences: number;
  unresolvedReferences: number;
  omittedReferenceTargets: number;
  omittedParentSymbolTargets: number;
  truncatedSymbolFiles: number;
  droppedSymbolNodes: number;
  droppedEdges: number;
  consistencyRetries: number;
  durationMs: number;
}

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

export interface RepoGraphBuildAttempt {
  nodes: RepoGraphNode[];
  edges: RepoGraphEdge[];
  warnings: RepoGraphWarning[];
  availableFiles: number;
  indexedFiles: number;
  filesTruncated: boolean;
  nodesTruncated: boolean;
  symbolsTruncated: boolean;
  edgesTruncated: boolean;
  unresolvedImports: number;
  omittedImportTargets: number;
  ambiguousReferences: number;
  unresolvedReferences: number;
  omittedReferenceTargets: number;
  omittedParentSymbolTargets: number;
  truncatedSymbolFiles: number;
  droppedSymbolNodes: number;
  droppedEdges: number;
}

export interface RepoGraphBuilderDependencies {
  codeIndex: CodeIndexReadPort;
}

export interface RepoGraphIncludedFileResult {
  files: CodeIndexFile[];
  totalAvailable: number;
  sourceTruncated: boolean;
  nodeLimitTruncated: boolean;
}
