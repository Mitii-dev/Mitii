import type {
  RepoGraph,
  RepoGraphEdge,
  RepoGraphFileNode,
  RepoGraphNode,
  RepoGraphProjectNode,
  RepoGraphSymbolNode,
} from "../../../repository-state";


export function createGraph(input: {
  nodes: readonly RepoGraphNode[];
  edges: readonly RepoGraphEdge[];
  status?: RepoGraph["status"];
  statistics?: Partial<RepoGraph["statistics"]>;
}): RepoGraph {
  return {
    schemaVersion: 1,
    workspaceSnapshotId: "snapshot-1",
    codeIndexChangeToken: "token-1",
    nodes: [...input.nodes],
    edges: [...input.edges],
    warnings: [],
    statistics: {
      availableFiles: input.nodes.filter((node) => node.kind === "file").length,
      indexedFiles: input.nodes.filter((node) => node.kind === "file").length,
      projectNodes: input.nodes.filter((node) => node.kind === "project").length,
      fileNodes: input.nodes.filter((node) => node.kind === "file").length,
      symbolNodes: input.nodes.filter((node) => node.kind === "symbol").length,
      containsEdges: 0,
      declaresEdges: 0,
      importEdges: input.edges.filter((edge) => edge.type === "imports").length,
      callEdges: input.edges.filter((edge) => edge.type === "calls").length,
      referenceEdges: input.edges.filter((edge) => edge.type === "references").length,
      projectRelationshipEdges: input.edges.filter(
        (edge) =>
          edge.type === "depends_on" ||
          edge.type === "development_depends_on" ||
          edge.type === "workspace_member",
      ).length,
      unresolvedImports: 0,
      omittedImportTargets: 0,
      ambiguousReferences: 0,
      unresolvedReferences: 0,
      omittedReferenceTargets: 0,
      omittedParentSymbolTargets: 0,
      truncatedSymbolFiles: 0,
      droppedSymbolNodes: 0,
      droppedEdges: 0,
      consistencyRetries: 0,
      durationMs: 1,
      ...input.statistics,
    },
    status: input.status ?? "complete",
    generatedAt: "2026-08-13T00:00:00.000Z",
  };
}

export function projectNode(
  id: string,
  projectId: string,
  name: string,
): RepoGraphProjectNode {
  return {
    id,
    kind: "project",
    projectId,
    rootId: "workspace",
    relativeRoot: "",
    name,
    ecosystems: ["node"],
  };
}

export function fileNode(
  id: string,
  relativePath: string,
  projectId?: string,
): RepoGraphFileNode {
  return {
    id,
    kind: "file",
    fileId: id,
    rootId: "workspace",
    relativePath,
    ...(projectId ? { projectId } : {}),
  };
}

export function symbolNode(
  id: string,
  fileId: string,
  name: string,
  startLine: number,
  endLine: number,
  exported?: boolean,
  parentSymbolId?: string,
): RepoGraphSymbolNode {
  return {
    id,
    kind: "symbol",
    symbolId: id,
    fileId,
    name,
    symbolKind: "function",
    startLine,
    endLine,
    ...(exported === undefined ? {} : { exported }),
    ...(parentSymbolId ? { parentSymbolId } : {}),
  };
}

export function edge(
  id: string,
  type: RepoGraphEdge["type"],
  fromNodeId: string,
  toNodeId: string,
  weight: number,
  line: number,
): RepoGraphEdge {
  return {
    id,
    type,
    fromNodeId,
    toNodeId,
    weight,
    evidenceCount: 1,
    evidence: [
      {
        source: type === "depends_on" ? "project_catalog" : "code_index_reference",
        detail: `${fromNodeId} ${type} ${toNodeId}`,
        line,
      },
    ],
    evidenceTruncated: false,
  };
}
