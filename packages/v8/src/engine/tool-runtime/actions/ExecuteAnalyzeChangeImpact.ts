import {
  CHANGE_IMPACT_SCHEMA_VERSION,
  ChangeImpactPipeline,
  changeImpactResultSchema,
  type ChangeImpactInput,
} from "../../../modules/change-impact";
import type { RepoGraph } from "../../../modules/repository-state";
import type { RepositoryGraphPort } from "../contracts";
import { ToolRuntimeError } from "../contracts";
import {
  analyzeChangeImpactInputSchema,
  analyzeChangeImpactOutputSchema,
} from "../internal/ToolCatalog";

export async function executeAnalyzeChangeImpact(params: {
  arguments: unknown;
  repoGraphs?: RepositoryGraphPort;
  /** Host/intake dirty paths for this run (pre-existing uncommitted edits). */
  dirtyPaths?: readonly string[];
  /** Paths already mutated earlier in this run. */
  alreadyMutatedPaths?: readonly string[];
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
  const input = analyzeChangeImpactInputSchema.parse(params.arguments);

  if (!params.repoGraphs) {
    return unavailableOutput(input.path);
  }

  const graphs = await params.repoGraphs.loadGraphs();
  if (graphs.length === 0) {
    return unavailableOutput(input.path);
  }

  const graph = selectGraph(graphs, input.path) ?? graphs[0];
  if (!graph) {
    throw new ToolRuntimeError(
      "misconfigured_ports",
      "Repository graph port returned no graph.",
    );
  }

  const workspaceDirtyDuringRun =
    (params.dirtyPaths?.length ?? 0) > 0 ||
    (params.alreadyMutatedPaths?.length ?? 0) > 0;

  let expectedCodeIndexChangeToken =
    params.repoGraphs.expectedCodeIndexChangeToken
      ? await params.repoGraphs.expectedCodeIndexChangeToken(graph)
      : undefined;

  // In-run edits invalidate the published graph even when the host watermark
  // has not been refreshed yet.
  if (workspaceDirtyDuringRun) {
    const base =
      expectedCodeIndexChangeToken ?? graph.codeIndexChangeToken ?? "run";
    if (base === graph.codeIndexChangeToken) {
      expectedCodeIndexChangeToken = `${base}:run-dirty`;
    }
  }

  const result = new ChangeImpactPipeline().analyze({
    schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
    seed: toSeed(input),
    repoGraph: graph,
    ...(expectedCodeIndexChangeToken
      ? { codeIndexChangeToken: expectedCodeIndexChangeToken }
      : {}),
    ...(input.edgeTypes ? { edgeTypes: input.edgeTypes } : {}),
    ...(input.maximumHops ? { maximumHops: input.maximumHops } : {}),
    ...(input.maximumAffectedNodes
      ? { maximumAffectedNodes: input.maximumAffectedNodes }
      : {}),
    ...(typeof input.includePackages === "boolean"
      ? { includePackages: input.includePackages }
      : {}),
    ...(input.direction ? { direction: input.direction } : {}),
  } satisfies ChangeImpactInput);

  const parsed = changeImpactResultSchema.parse(result);
  const output = analyzeChangeImpactOutputSchema.parse({
    path: input.path,
    provider: "repo_graph",
    status: parsed.status,
    resolvedSeeds: parsed.resolvedSeeds.map((seed) => ({
      kind: seed.kind,
      ...(seed.relativePath ? { path: seed.relativePath } : {}),
      ...(seed.symbolName ? { symbolName: seed.symbolName } : {}),
      ...(seed.symbolKind ? { symbolKind: seed.symbolKind } : {}),
    })),
    affected: parsed.affected.map((node) => ({
      path: node.relativePath,
      ...(node.symbolName ? { symbolName: node.symbolName } : {}),
      ...(node.symbolKind ? { symbolKind: node.symbolKind } : {}),
      hop: node.hop,
      viaEdgeType: node.viaEdgeType,
      score: node.score,
      evidence: node.evidence,
    })),
    affectedFiles: parsed.affectedFiles.map((file) => ({
      path: file.relativePath,
      hop: file.hop,
      score: file.score,
      affectedNodeCount: file.affectedNodeIds.length,
      reason: file.reason,
    })),
    packagesAffected: parsed.packagesAffected.map((project) => ({
      name: project.name,
      projectId: project.projectId,
      hop: project.hop,
      ...(project.viaEdgeType ? { viaEdgeType: project.viaEdgeType } : {}),
    })),
    truncated: parsed.truncated,
    warnings: parsed.warnings,
    reasonCodes: parsed.reasonCodes,
    graphRevision: parsed.graphRevision,
    codeIndexChangeToken: parsed.codeIndexChangeToken,
  });

  return {
    output,
    truncated: parsed.truncated,
    redacted: false,
  };
}

function toSeed(input: {
  path: string;
  line?: number;
  column?: number;
  symbolName?: string;
}): ChangeImpactInput["seed"] {
  if (input.line !== undefined) {
    return {
      kind: "caret",
      relativePath: input.path,
      line: input.line,
      column: input.column ?? 1,
      ...(input.symbolName ? { symbolName: input.symbolName } : {}),
    };
  }
  if (input.symbolName) {
    return {
      kind: "symbol",
      relativePath: input.path,
      symbolName: input.symbolName,
    };
  }
  return {
    kind: "file",
    relativePath: input.path,
  };
}

function selectGraph(
  graphs: readonly RepoGraph[],
  path: string,
): RepoGraph | undefined {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  return graphs.find((graph) =>
    graph.nodes.some(
      (node) =>
        node.kind === "file" &&
        node.relativePath.replace(/\\/g, "/").replace(/^\.\//, "") === normalized,
    ),
  );
}

function unavailableOutput(
  path: string,
): { output: unknown; truncated: boolean; redacted: boolean } {
  return {
    output: analyzeChangeImpactOutputSchema.parse({
      path,
      provider: "repo_graph",
      status: "unavailable",
      resolvedSeeds: [],
      affected: [],
      affectedFiles: [],
      packagesAffected: [],
      truncated: false,
      warnings: [],
      reasonCodes: ["graph_unavailable"],
    }),
    truncated: false,
    redacted: false,
  };
}
