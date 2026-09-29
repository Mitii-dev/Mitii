import {
  CHANGE_IMPACT_SCHEMA_VERSION,
} from "../constants";
import {
  ChangeImpactError,
  changeImpactInputSchema,
  changeImpactResultSchema,
} from "../contracts";
import type {
  ChangeImpactParsedInput,
  ChangeImpactReasonCode,
  ChangeImpactResult,
  ChangeImpactWarningCode,
} from "../contracts";
import {
  bucketSortKey,
  classifyImpactBucket,
} from "../internal/classifyImpactBucket";
import { collectBoundedChains } from "../internal/collectBoundedChains";
import { resolveSoftSymbolMatches } from "../internal/resolveSoftSymbolMatches";
import { walkBoundedDependents } from "../internal/walkBoundedDependents";
import { CHANGE_IMPACT_POLICY } from "../policy";
import type {
  RepoGraph,
  RepoGraphEdge,
  RepoGraphEdgeType,
  RepoGraphFileNode,
  RepoGraphNode,
  RepoGraphSymbolNode,
} from "../../repository-state";

type RepoGraphProjectNode = Extract<RepoGraphNode, { kind: "project" }>;
type ChangeImpactEdgeType = ChangeImpactParsedInput["edgeTypes"][number];
type ChangeImpactEdge = RepoGraphEdge & { type: ChangeImpactEdgeType };
type SeedExpansion = ChangeImpactParsedInput["seedExpansion"];

interface ResolvedSeedNode {
  node: RepoGraphFileNode | RepoGraphSymbolNode | RepoGraphProjectNode;
  file?: RepoGraphFileNode;
}

interface WalkVisit {
  nodeId: string;
  hop: number;
  viaEdge: ChangeImpactEdge;
  score: number;
  pathNodeIds: string[];
}

interface ImpactAdjacencyEdge {
  nodeId: string;
  edge: ChangeImpactEdge;
}

/**
 * Answers blast-radius questions over a published RepoGraph.
 * Edges are recorded dependent → dependency. `dependents` walks them in
 * reverse (who points at the seed). `dependencies` walks them forward
 * (what the seed imports / depends on).
 */
export class ChangeImpactPipeline {
  public analyze(input: ChangeImpactParsedInput | unknown): ChangeImpactResult {
    let parsed: ChangeImpactParsedInput;
    try {
      parsed = changeImpactInputSchema.parse(input);
    } catch (error) {
      throw new ChangeImpactError(
        "invalid_input",
        "Change impact input failed schema validation.",
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const graph = parsed.repoGraph;
    const nodeById = createNodeIndex(graph);
    const fileByFileId = createFileIndex(graph);
    const projectByProjectId = createProjectIndex(graph);
    const warnings: Array<{
      code: ChangeImpactWarningCode;
      message: string;
    }> = [];
    const reasonCodes = new Set<ChangeImpactReasonCode>();
    let truncated = false;

    if (graph.status === "partial") {
      warnings.push({
        code: "graph_partial",
        message: "Repository graph was built partially; impact may be incomplete.",
      });
    }

    if (
      parsed.codeIndexChangeToken &&
      parsed.codeIndexChangeToken !== graph.codeIndexChangeToken
    ) {
      reasonCodes.add("graph_stale");
    }

    const resolvedSeeds = this.resolveSeed({
      input: parsed,
      nodeById,
      fileByFileId,
      projectByProjectId,
      warnings,
      reasonCodes,
    });

    if (resolvedSeeds.length === 0) {
      reasonCodes.add("seed_unresolved");
      return changeImpactResultSchema.parse({
        schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
        status:
          reasonCodes.has("graph_stale") || graph.status === "partial"
            ? "partial"
            : "empty",
        direction: parsed.direction,
        seed: parsed.seed,
        resolvedSeeds: [],
        affected: [],
        affectedFiles: [],
        packagesAffected: [],
        chains: [],
        directNeighborCounts: { nodes: 0, files: 0 },
        truncated: false,
        warnings,
        reasonCodes: [...reasonCodes],
        graphRevision: graph.workspaceSnapshotId,
        codeIndexChangeToken: graph.codeIndexChangeToken,
      });
    }

    const walk = this.walkImpact({
      graph,
      seedNodeIds: resolvedSeeds.map((seed) => seed.node.id),
      edgeTypes: parsed.edgeTypes,
      maximumHops: parsed.maximumHops,
      maximumAffectedNodes: parsed.maximumAffectedNodes,
      maximumPaths: parsed.maximumPaths,
      nodeById,
      fileByFileId,
      importanceByRelativePath: parsed.importanceByRelativePath,
      reverse: parsed.direction !== "dependencies",
    });
    truncated = walk.truncated;
    for (const code of walk.reasonCodes) {
      reasonCodes.add(code);
    }

    const affected = this.toAffectedNodes({
      visits: walk.visits,
      nodeById,
      fileByFileId,
      graph,
      warnings,
    });
    const affectedFiles = this.aggregateAffectedFiles(affected);
    const packagesAffected = parsed.includePackages
      ? this.toAffectedPackages({
          visits: walk.visits,
          nodeById,
          maximumPackages: CHANGE_IMPACT_POLICY.maximumPackages,
        })
      : [];
    const chains = this.toChains({
      rawChains: walk.chains,
      nodeById,
      fileByFileId,
    });
    const directNeighborCounts = this.countDirectNeighbors({
      visits: walk.visits,
      nodeById,
      fileByFileId,
    });

    if (affected.length > 0 || packagesAffected.length > 0) {
      reasonCodes.add("impact_resolved");
    } else {
      reasonCodes.add(
        parsed.direction === "dependencies"
          ? "no_dependencies"
          : "no_dependents",
      );
    }

    const status =
      truncated || reasonCodes.has("graph_stale") || graph.status === "partial"
        ? "partial"
        : affected.length > 0 || packagesAffected.length > 0
          ? "ok"
          : "empty";

    return changeImpactResultSchema.parse({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      status,
      direction: parsed.direction,
      seed: parsed.seed,
      resolvedSeeds: resolvedSeeds.map(({ node, file }) => ({
        nodeId: node.id,
        kind: node.kind,
        ...(file ? { relativePath: file.relativePath } : {}),
        ...(node.kind === "file" ? { relativePath: node.relativePath } : {}),
        ...(node.kind === "symbol"
          ? {
              symbolName: node.name,
              symbolKind: node.symbolKind,
              ...(typeof node.startLine === "number"
                ? { startLine: node.startLine }
                : {}),
            }
          : {}),
      })),
      affected,
      affectedFiles,
      packagesAffected,
      chains,
      directNeighborCounts,
      truncated,
      warnings,
      reasonCodes: [...reasonCodes],
      graphRevision: graph.workspaceSnapshotId,
      codeIndexChangeToken: graph.codeIndexChangeToken,
    });
  }

  private resolveSeed(params: {
    input: ChangeImpactParsedInput;
    nodeById: ReadonlyMap<string, RepoGraphNode>;
    fileByFileId: ReadonlyMap<string, RepoGraphFileNode>;
    projectByProjectId: ReadonlyMap<string, RepoGraphProjectNode>;
    warnings: Array<{ code: ChangeImpactWarningCode; message: string }>;
    reasonCodes: Set<ChangeImpactReasonCode>;
  }): ResolvedSeedNode[] {
    const seed = params.input.seed;
    const file = this.findFile(params.fileByFileId, seed.relativePath, seed.rootId);
    if (!file) return [];

    if (seed.kind === "file") {
      return this.expandFileSeed({
        file,
        input: params.input,
        nodeById: params.nodeById,
        projectByProjectId: params.projectByProjectId,
        graphEdges: params.input.repoGraph.edges,
      });
    }

    const symbols = [...params.nodeById.values()].filter(
      (node): node is RepoGraphSymbolNode =>
        node.kind === "symbol" &&
        node.fileId === file.fileId &&
        (seed.kind === "caret"
          ? this.symbolMatchesCaret(node, seed.line, seed.symbolName)
          : node.name === seed.symbolName) &&
        (seed.kind !== "symbol" ||
          seed.startLine === undefined ||
          node.startLine === seed.startLine),
    );

    const selected =
      seed.kind === "caret"
        ? symbols
            .sort((left, right) => {
              // Prefer nearest enclosing: largest startLine among covers, then
              // smallest span (Goose-style disambiguation + nested symbols).
              const startDelta =
                (right.startLine ?? 1) - (left.startLine ?? 1);
              if (startDelta !== 0) return startDelta;
              return symbolSpan(left) - symbolSpan(right);
            })
            .slice(0, 1)
        : symbols;

    if (selected.length > 1) {
      params.reasonCodes.add("seed_ambiguous");
    }

    let resolved = selected;
    if (resolved.length === 0) {
      const symbolsInFile = [...params.nodeById.values()].filter(
        (node): node is RepoGraphSymbolNode =>
          node.kind === "symbol" && node.fileId === file.fileId,
      );
      const soft = resolveSoftSymbolMatches({
        symbolsInFile,
        symbolName:
          seed.kind === "symbol" || seed.kind === "caret"
            ? seed.symbolName
            : undefined,
        line: seed.kind === "caret" ? seed.line : undefined,
        textOccurrenceLines: (params.input.textOccurrenceHints ?? [])
          .filter((hint) => {
            if (!hint.symbolName) return true;
            const seedName =
              seed.kind === "symbol" || seed.kind === "caret"
                ? seed.symbolName
                : undefined;
            return !seedName || hint.symbolName === seedName;
          })
          .map((hint) => hint.line),
      });
      if (soft.length > 0) {
        resolved = soft;
        params.reasonCodes.add("seed_soft_resolved");
        params.warnings.push({
          code: "seed_soft_matched",
          message:
            "Seed symbol matched via soft name/occurrence fallback before file-level expand.",
        });
      }
    }

    if (resolved.length === 0) {
      params.warnings.push({
        code: "seed_file_only",
        message:
          "Seed symbol was not resolved; falling back to file-level impact.",
      });
      return this.expandFileSeed({
        file,
        input: params.input,
        nodeById: params.nodeById,
        projectByProjectId: params.projectByProjectId,
        graphEdges: params.input.repoGraph.edges,
      });
    }

    const seeds: ResolvedSeedNode[] = resolved.map((node) => ({ node, file }));
    const project = file.projectId
      ? params.projectByProjectId.get(file.projectId)
      : undefined;
    if (params.input.includePackages && project) {
      seeds.push({ node: project });
    }
    return seeds;
  }

  private expandFileSeed(params: {
    file: RepoGraphFileNode;
    input: ChangeImpactParsedInput;
    nodeById: ReadonlyMap<string, RepoGraphNode>;
    projectByProjectId: ReadonlyMap<string, RepoGraphProjectNode>;
    graphEdges: readonly RepoGraphEdge[];
  }): ResolvedSeedNode[] {
    const seeds: ResolvedSeedNode[] = [{ node: params.file, file: params.file }];
    const symbolsInFile = [...params.nodeById.values()].filter(
      (node): node is RepoGraphSymbolNode =>
        node.kind === "symbol" && node.fileId === params.file.fileId,
    );

    const expansion: SeedExpansion = params.input.seedExpansion;
    if (expansion === "file_all_symbols") {
      for (const node of symbolsInFile) {
        seeds.push({ node, file: params.file });
      }
    } else if (expansion === "file_exports") {
      for (const node of selectExportSeeds({
        symbolsInFile,
        fileNodeId: params.file.id,
        edges: params.graphEdges,
      })) {
        seeds.push({ node, file: params.file });
      }
    }

    const project = params.file.projectId
      ? params.projectByProjectId.get(params.file.projectId)
      : undefined;
    if (params.input.includePackages && project) {
      seeds.push({ node: project });
    }
    return seeds;
  }

  private walkImpact(params: {
    graph: RepoGraph;
    seedNodeIds: readonly string[];
    edgeTypes: readonly ChangeImpactEdgeType[];
    maximumHops: number;
    maximumAffectedNodes: number;
    maximumPaths: number;
    nodeById: ReadonlyMap<string, RepoGraphNode>;
    fileByFileId: ReadonlyMap<string, RepoGraphFileNode>;
    importanceByRelativePath?: Readonly<Record<string, number>>;
    reverse: boolean;
  }): {
    visits: WalkVisit[];
    chains: Array<{
      nodeIds: string[];
      hop: number;
      tipEdge: ChangeImpactEdge;
      score: number;
    }>;
    truncated: boolean;
    reasonCodes: ChangeImpactReasonCode[];
  } {
    const adjacency = this.createImpactAdjacency(params);
    const inDegree = createInDegree(adjacency);
    const importanceByNodeId = createImportanceByNodeId({
      nodeById: params.nodeById,
      fileByFileId: params.fileByFileId,
      importanceByRelativePath: params.importanceByRelativePath,
    });
    const scoreFn = (edge: ChangeImpactEdge, hop: number, nodeId: string) =>
      impactScore(
        edge,
        hop,
        inDegree.get(nodeId) ?? 0,
        importanceByNodeId.get(nodeId) ?? 0,
      );
    const walked = walkBoundedDependents({
      seedNodeIds: params.seedNodeIds,
      maximumHops: params.maximumHops,
      maximumAffectedNodes: params.maximumAffectedNodes,
      adjacency,
      nodeExists: (nodeId) => params.nodeById.has(nodeId),
      score: scoreFn,
      compareVisits,
    });
    const chained = collectBoundedChains({
      seedNodeIds: params.seedNodeIds,
      maximumHops: params.maximumHops,
      maximumPaths: params.maximumPaths,
      adjacency,
      nodeExists: (nodeId) => params.nodeById.has(nodeId),
      score: scoreFn,
    });
    return {
      visits: walked.visits,
      chains: chained.chains.map((chain) => ({
        nodeIds: chain.nodeIds,
        hop: chain.hop,
        tipEdge: chain.tipEdge as ChangeImpactEdge,
        score: chain.score,
      })),
      truncated: walked.truncated || chained.truncated,
      reasonCodes: [...walked.reasonCodes, ...chained.reasonCodes],
    };
  }

  private createImpactAdjacency(params: {
    graph: RepoGraph;
    edgeTypes: readonly ChangeImpactEdgeType[];
    nodeById: ReadonlyMap<string, RepoGraphNode>;
    reverse: boolean;
  }): ReadonlyMap<string, readonly ImpactAdjacencyEdge[]> {
    const edgeTypes = new Set<ChangeImpactEdgeType>(params.edgeTypes);
    const adjacency = new Map<string, ImpactAdjacencyEdge[]>();

    for (const edge of params.graph.edges) {
      if (
        !isChangeImpactEdgeType(edge.type) ||
        !edgeTypes.has(edge.type) ||
        !CHANGE_IMPACT_POLICY.reverseEdgeTypes.has(edge.type) ||
        !params.nodeById.has(edge.fromNodeId) ||
        !params.nodeById.has(edge.toNodeId)
      ) {
        continue;
      }
      const impactEdge = edge as ChangeImpactEdge;
      const fromId = params.reverse
        ? impactEdge.toNodeId
        : impactEdge.fromNodeId;
      const toId = params.reverse
        ? impactEdge.fromNodeId
        : impactEdge.toNodeId;
      const neighbors = adjacency.get(fromId) ?? [];
      neighbors.push({ nodeId: toId, edge: impactEdge });
      adjacency.set(fromId, neighbors);
    }

    for (const neighbors of adjacency.values()) {
      neighbors.sort(
        (left, right) =>
          edgeTypeOrder(left.edge.type) - edgeTypeOrder(right.edge.type) ||
          right.edge.weight - left.edge.weight ||
          left.nodeId.localeCompare(right.nodeId) ||
          left.edge.id.localeCompare(right.edge.id),
      );
    }

    return adjacency;
  }

  private toAffectedNodes(params: {
    visits: readonly WalkVisit[];
    nodeById: ReadonlyMap<string, RepoGraphNode>;
    fileByFileId: ReadonlyMap<string, RepoGraphFileNode>;
    graph: RepoGraph;
    warnings: Array<{ code: ChangeImpactWarningCode; message: string }>;
  }): ChangeImpactResult["affected"] {
    const affected: ChangeImpactResult["affected"] = [];

    for (const visit of params.visits) {
      const node = params.nodeById.get(visit.nodeId);
      if (!node || node.kind === "project") continue;
      const file = node.kind === "file" ? node : params.fileByFileId.get(node.fileId);
      if (!file) continue;

      if (visit.viaEdge.evidenceTruncated) {
        params.warnings.push({
          code: "evidence_truncated",
          message: `Graph evidence for edge ${visit.viaEdge.id} was truncated.`,
        });
      }

      const bucket = classifyImpactBucket(file.relativePath);
      const score =
        bucket === "test"
          ? Number(
              (visit.score * CHANGE_IMPACT_POLICY.testScoreFactor).toFixed(3),
            )
          : visit.score;

      const evidence: string[] = [];
      const chainLabel = formatPathLabels(
        visit.pathNodeIds,
        params.nodeById,
        params.fileByFileId,
      );
      if (chainLabel.length >= 2) {
        evidence.push(`chain: ${chainLabel.join(" → ")}`);
      }
      for (const item of visit.viaEdge.evidence.slice(0, 4)) {
        evidence.push(
          [item.source, item.detail, item.line ? `line ${item.line}` : undefined]
            .filter(Boolean)
            .join(": "),
        );
      }

      affected.push({
        nodeId: node.id,
        kind: node.kind,
        relativePath: file.relativePath,
        ...(node.kind === "symbol"
          ? {
              symbolName: node.name,
              symbolKind: node.symbolKind,
            }
          : {}),
        hop: visit.hop,
        viaEdgeType: visit.viaEdge.type,
        viaEdgeId: visit.viaEdge.id,
        score,
        evidence: evidence.slice(0, 5),
      });
    }

    affected.sort(compareAffectedNodes);
    return affected;
  }

  private toChains(params: {
    rawChains: readonly {
      nodeIds: string[];
      hop: number;
      tipEdge: ChangeImpactEdge;
      score: number;
    }[];
    nodeById: ReadonlyMap<string, RepoGraphNode>;
    fileByFileId: ReadonlyMap<string, RepoGraphFileNode>;
  }): ChangeImpactResult["chains"] {
    return params.rawChains.map((chain) => ({
      links: chain.nodeIds.map((nodeId) => {
        const node = params.nodeById.get(nodeId);
        if (!node || node.kind === "project") {
          return { nodeId };
        }
        const file =
          node.kind === "file" ? node : params.fileByFileId.get(node.fileId);
        return {
          nodeId,
          ...(file ? { relativePath: file.relativePath } : {}),
          ...(node.kind === "symbol" ? { symbolName: node.name } : {}),
        };
      }),
      hop: chain.hop,
      score: chain.score,
      viaEdgeType: chain.tipEdge.type,
    }));
  }

  private aggregateAffectedFiles(
    affected: ChangeImpactResult["affected"],
  ): ChangeImpactResult["affectedFiles"] {
    const byPath = new Map<string, ChangeImpactResult["affectedFiles"][number]>();
    for (const node of affected) {
      const bucket = classifyImpactBucket(node.relativePath);
      const current = byPath.get(node.relativePath);
      if (!current) {
        byPath.set(node.relativePath, {
          relativePath: node.relativePath,
          hop: node.hop,
          score: node.score,
          affectedNodeIds: [node.nodeId],
          reason: `${node.viaEdgeType} dependent at hop ${node.hop}`,
          bucket,
        });
        continue;
      }
      current.affectedNodeIds.push(node.nodeId);
      current.hop = Math.min(current.hop, node.hop);
      current.score = Math.max(current.score, node.score);
    }
    return [...byPath.values()].sort(
      (left, right) =>
        left.hop - right.hop ||
        bucketSortKey(left.bucket) - bucketSortKey(right.bucket) ||
        right.score - left.score ||
        left.relativePath.localeCompare(right.relativePath),
    );
  }

  private countDirectNeighbors(params: {
    visits: readonly WalkVisit[];
    nodeById: ReadonlyMap<string, RepoGraphNode>;
    fileByFileId: ReadonlyMap<string, RepoGraphFileNode>;
  }): ChangeImpactResult["directNeighborCounts"] {
    const hop1 = params.visits.filter((visit) => visit.hop === 1);
    const files = new Set<string>();
    let nodes = 0;
    for (const visit of hop1) {
      const node = params.nodeById.get(visit.nodeId);
      if (!node || node.kind === "project") continue;
      nodes += 1;
      const file =
        node.kind === "file" ? node : params.fileByFileId.get(node.fileId);
      if (file) files.add(file.relativePath);
    }
    return { nodes, files: files.size };
  }

  private toAffectedPackages(params: {
    visits: readonly WalkVisit[];
    nodeById: ReadonlyMap<string, RepoGraphNode>;
    maximumPackages: number;
  }): ChangeImpactResult["packagesAffected"] {
    const packages = new Map<string, ChangeImpactResult["packagesAffected"][number]>();
    for (const visit of params.visits) {
      const node = params.nodeById.get(visit.nodeId);
      if (!node || node.kind !== "project") continue;
      const current = packages.get(node.projectId);
      if (!current || visit.hop < current.hop) {
        packages.set(node.projectId, {
          projectId: node.projectId,
          name: node.name,
          hop: visit.hop,
          viaEdgeType: visit.viaEdge.type,
        });
      }
    }
    return [...packages.values()]
      .sort(
        (left, right) =>
          left.hop - right.hop ||
          left.name.localeCompare(right.name) ||
          left.projectId.localeCompare(right.projectId),
      )
      .slice(0, params.maximumPackages);
  }

  private findFile(
    fileByFileId: ReadonlyMap<string, RepoGraphFileNode>,
    relativePath: string,
    rootId?: string,
  ): RepoGraphFileNode | undefined {
    const normalized = normalizeRelativePath(relativePath);
    return [...fileByFileId.values()].find(
      (file) =>
        normalizeRelativePath(file.relativePath) === normalized &&
        (!rootId || file.rootId === rootId),
    );
  }

  private symbolMatchesCaret(
    node: RepoGraphSymbolNode,
    line: number,
    symbolName?: string,
  ): boolean {
    if (symbolName && node.name !== symbolName) {
      return false;
    }
    return coversLine(node, line);
  }
}

function createNodeIndex(graph: RepoGraph): Map<string, RepoGraphNode> {
  const nodeById = new Map<string, RepoGraphNode>();
  for (const node of graph.nodes) {
    nodeById.set(node.id, node);
  }
  return nodeById;
}

function createFileIndex(graph: RepoGraph): Map<string, RepoGraphFileNode> {
  const fileByFileId = new Map<string, RepoGraphFileNode>();
  for (const node of graph.nodes) {
    if (node.kind === "file") {
      fileByFileId.set(node.fileId, node);
    }
  }
  return fileByFileId;
}

function createProjectIndex(graph: RepoGraph): Map<string, RepoGraphProjectNode> {
  const projectByProjectId = new Map<string, RepoGraphProjectNode>();
  for (const node of graph.nodes) {
    if (node.kind === "project") {
      projectByProjectId.set(node.projectId, node);
    }
  }
  return projectByProjectId;
}

function createInDegree(
  adjacency: ReadonlyMap<string, readonly ImpactAdjacencyEdge[]>,
): Map<string, number> {
  const inDegree = new Map<string, number>();
  for (const neighbors of adjacency.values()) {
    for (const neighbor of neighbors) {
      inDegree.set(neighbor.nodeId, (inDegree.get(neighbor.nodeId) ?? 0) + 1);
    }
  }
  return inDegree;
}

/**
 * Prefer explicitly exported symbols; otherwise symbols that are targets of
 * inbound impact edges from outside the file. Never expands every symbol.
 */
function selectExportSeeds(params: {
  symbolsInFile: readonly RepoGraphSymbolNode[];
  fileNodeId: string;
  edges: readonly RepoGraphEdge[];
}): RepoGraphSymbolNode[] {
  const exported = params.symbolsInFile.filter((node) => node.exported === true);
  if (exported.length > 0) {
    return exported;
  }

  const hasExportMetadata = params.symbolsInFile.some(
    (node) => typeof node.exported === "boolean",
  );
  if (hasExportMetadata) {
    // Symbols are known non-exported; keep file-only.
    return [];
  }

  const symbolIds = new Set(params.symbolsInFile.map((node) => node.id));
  const externalTargets = new Set<string>();
  for (const edge of params.edges) {
    if (
      !isChangeImpactEdgeType(edge.type) ||
      !CHANGE_IMPACT_POLICY.reverseEdgeTypes.has(edge.type)
    ) {
      continue;
    }
    if (!symbolIds.has(edge.toNodeId)) continue;
    if (symbolIds.has(edge.fromNodeId) || edge.fromNodeId === params.fileNodeId) {
      continue;
    }
    externalTargets.add(edge.toNodeId);
  }

  return params.symbolsInFile.filter((node) => externalTargets.has(node.id));
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function coversLine(node: RepoGraphSymbolNode, line: number): boolean {
  const start = node.startLine ?? 1;
  const end = node.endLine ?? start;
  return line >= start && line <= end;
}

function symbolSpan(node: RepoGraphSymbolNode): number {
  return (node.endLine ?? node.startLine ?? 1) - (node.startLine ?? 1);
}

function edgeTypeOrder(edgeType: RepoGraphEdgeType): number {
  const order = CHANGE_IMPACT_POLICY.defaultEdgeTypes.indexOf(
    edgeType as (typeof CHANGE_IMPACT_POLICY.defaultEdgeTypes)[number],
  );
  return order >= 0 ? order : Number.MAX_SAFE_INTEGER;
}

function createImportanceByNodeId(params: {
  nodeById: ReadonlyMap<string, RepoGraphNode>;
  fileByFileId: ReadonlyMap<string, RepoGraphFileNode>;
  importanceByRelativePath?: Readonly<Record<string, number>>;
}): Map<string, number> {
  const map = new Map<string, number>();
  if (!params.importanceByRelativePath) return map;
  for (const node of params.nodeById.values()) {
    if (node.kind === "project") continue;
    const file =
      node.kind === "file" ? node : params.fileByFileId.get(node.fileId);
    if (!file) continue;
    const key = normalizeRelativePath(file.relativePath);
    const value =
      params.importanceByRelativePath[key] ??
      params.importanceByRelativePath[file.relativePath];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      map.set(node.id, value);
    }
  }
  return map;
}

function impactScore(
  edge: ChangeImpactEdge,
  hop: number,
  fanIn: number,
  importance = 0,
): number {
  const edgeFactor = CHANGE_IMPACT_POLICY.edgeTypeScore[edge.type] ?? 0.5;
  const base = (edge.weight * edgeFactor) / hop;
  const fanInBoost =
    1 +
    Math.min(CHANGE_IMPACT_POLICY.fanInCap, Math.max(0, fanIn)) *
      CHANGE_IMPACT_POLICY.fanInWeight;
  const evidenceBoost =
    1 +
    Math.min(
      CHANGE_IMPACT_POLICY.evidenceCap,
      Math.max(0, edge.evidenceCount),
    ) *
      CHANGE_IMPACT_POLICY.evidenceWeight;
  const pageRankBoost =
    1 +
    Math.min(CHANGE_IMPACT_POLICY.pageRankCap, Math.max(0, importance)) *
      CHANGE_IMPACT_POLICY.pageRankWeight;
  return Number((base * fanInBoost * evidenceBoost * pageRankBoost).toFixed(3));
}

function isChangeImpactEdgeType(
  edgeType: RepoGraphEdgeType,
): edgeType is ChangeImpactEdgeType {
  return CHANGE_IMPACT_POLICY.reverseEdgeTypes.has(edgeType);
}

function compareVisits(left: WalkVisit, right: WalkVisit): number {
  return (
    left.hop - right.hop ||
    right.score - left.score ||
    left.nodeId.localeCompare(right.nodeId) ||
    left.viaEdge.id.localeCompare(right.viaEdge.id)
  );
}

function compareAffectedNodes(
  left: ChangeImpactResult["affected"][number],
  right: ChangeImpactResult["affected"][number],
): number {
  return (
    left.hop - right.hop ||
    bucketSortKey(classifyImpactBucket(left.relativePath)) -
      bucketSortKey(classifyImpactBucket(right.relativePath)) ||
    right.score - left.score ||
    left.relativePath.localeCompare(right.relativePath) ||
    (left.symbolName ?? "").localeCompare(right.symbolName ?? "") ||
    left.nodeId.localeCompare(right.nodeId)
  );
}

function formatPathLabels(
  pathNodeIds: readonly string[],
  nodeById: ReadonlyMap<string, RepoGraphNode>,
  fileByFileId: ReadonlyMap<string, RepoGraphFileNode>,
): string[] {
  const labels: string[] = [];
  for (const nodeId of pathNodeIds) {
    const node = nodeById.get(nodeId);
    if (!node || node.kind === "project") continue;
    if (node.kind === "symbol") {
      const file = fileByFileId.get(node.fileId);
      labels.push(
        file
          ? `${file.relativePath}:${node.name}`
          : node.name,
      );
      continue;
    }
    labels.push(node.relativePath);
  }
  return labels;
}
