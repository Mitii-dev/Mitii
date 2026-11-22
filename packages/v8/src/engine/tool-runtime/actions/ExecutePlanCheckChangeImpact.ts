import {
  CHANGE_IMPACT_SCHEMA_VERSION,
  compactChangeImpactForModelFacing,
  planCheckChangeImpact,
} from "../../../modules/change-impact";
import type { RepoGraph } from "../../../modules/repository-state";
import type { RepositoryGraphPort } from "../contracts";
import { ToolRuntimeError } from "../contracts";
import {
  planCheckChangeImpactInputSchema,
  planCheckChangeImpactOutputSchema,
} from "../internal/ToolCatalog";

export async function executePlanCheckChangeImpact(params: {
  arguments: unknown;
  repoGraphs?: RepositoryGraphPort;
  dirtyPaths?: readonly string[];
  alreadyMutatedPaths?: readonly string[];
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
  const input = planCheckChangeImpactInputSchema.parse(params.arguments);

  if (!params.repoGraphs) {
    return unavailableOutput(input.proposedPaths);
  }

  const graphs = await params.repoGraphs.loadGraphs();
  if (graphs.length === 0) {
    return unavailableOutput(input.proposedPaths);
  }

  const graph = selectGraph(graphs, input.proposedPaths[0]!) ?? graphs[0];
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

  if (workspaceDirtyDuringRun) {
    const base =
      expectedCodeIndexChangeToken ?? graph.codeIndexChangeToken ?? "run";
    if (base === graph.codeIndexChangeToken) {
      expectedCodeIndexChangeToken = `${base}:run-dirty`;
    }
  }

  const importanceByRelativePath = await loadImportanceRecord(
    params.repoGraphs,
  );

  const result = planCheckChangeImpact({
    input: {
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      proposedPaths: input.proposedPaths,
      repoGraph: graph,
      ...(expectedCodeIndexChangeToken
        ? { codeIndexChangeToken: expectedCodeIndexChangeToken }
        : {}),
      ...(input.edgeTypes ? { edgeTypes: input.edgeTypes } : {}),
      ...(input.maximumHops ? { maximumHops: input.maximumHops } : {}),
      ...(input.maximumAffectedNodes
        ? { maximumAffectedNodes: input.maximumAffectedNodes }
        : {}),
      ...(input.maximumPaths ? { maximumPaths: input.maximumPaths } : {}),
      ...(typeof input.includePackages === "boolean"
        ? { includePackages: input.includePackages }
        : {}),
      ...(input.direction ? { direction: input.direction } : {}),
      ...(input.expectedPackages
        ? { expectedPackages: input.expectedPackages }
        : {}),
      ...(importanceByRelativePath
        ? { importanceByRelativePath }
        : {}),
    },
  });

  const slim = compactChangeImpactForModelFacing({
    affected: result.merged.affected.map((node) => ({
      path: node.relativePath,
      ...(node.symbolName ? { symbolName: node.symbolName } : {}),
      ...(node.symbolKind ? { symbolKind: node.symbolKind } : {}),
      hop: node.hop,
      viaEdgeType: node.viaEdgeType,
      score: node.score,
      evidence: node.evidence,
    })),
    affectedFiles: result.merged.affectedFiles.map((file) => ({
      path: file.relativePath,
      hop: file.hop,
      score: file.score,
      affectedNodeCount: file.affectedNodeIds.length,
      reason: file.reason,
      impactReason: file.impactReason,
      bucket: file.bucket,
    })),
    packagesAffected: result.merged.packagesAffected.map((project) => ({
      name: project.name,
      projectId: project.projectId,
      hop: project.hop,
      ...(project.viaEdgeType ? { viaEdgeType: project.viaEdgeType } : {}),
    })),
    chains: result.merged.chains.map((chain) => ({
      links: chain.links.map((link) => ({
        ...(link.relativePath ? { path: link.relativePath } : {}),
        ...(link.symbolName ? { symbolName: link.symbolName } : {}),
        nodeId: link.nodeId,
      })),
      hop: chain.hop,
      score: chain.score,
      ...(chain.viaEdgeType ? { viaEdgeType: chain.viaEdgeType } : {}),
    })),
  });

  const output = planCheckChangeImpactOutputSchema.parse({
    proposedPaths: result.proposedPaths,
    provider: "repo_graph",
    status: result.merged.status,
    affectedFiles: slim.affectedFiles,
    packagesAffected: slim.packagesAffected,
    ...(result.spillover
      ? {
          spillover: {
            withinExpected: result.spillover.withinExpected,
            expectedPackages: result.spillover.expectedPackages,
            matchedPackages: result.spillover.matchedPackages,
            spilloverPackages: result.spillover.spilloverPackages,
          },
        }
      : {}),
    confidence: result.merged.confidence,
    graphConfidenceUnsafe: result.merged.graphConfidenceUnsafe,
    blastRadius: result.merged.blastRadius,
    widenVerification: result.widenVerification,
    truncated: result.merged.truncated || slim.modelFacingTruncated,
    warnings: [
      ...result.warnings,
      ...(slim.modelFacingTruncated
        ? [
            {
              code: "model_facing_truncated",
              message: `Plan-check affected files capped for tool-result budget (kept ${slim.affectedFiles.length} of ${slim.totalAffectedFiles}).`,
            },
          ]
        : []),
    ],
    reasonCodes: [
      ...result.reasonCodes,
      ...(slim.modelFacingTruncated ? ["model_facing_truncated"] : []),
    ],
  });

  return {
    output,
    truncated: false,
    redacted: false,
  };
}

function unavailableOutput(proposedPaths: readonly string[]) {
  return {
    output: planCheckChangeImpactOutputSchema.parse({
      proposedPaths: [...proposedPaths],
      provider: "repo_graph",
      status: "unavailable",
      affectedFiles: [],
      packagesAffected: [],
      widenVerification: true,
      truncated: false,
      warnings: [
        {
          code: "graph_unavailable",
          message: "Repository graph is unavailable for plan-check.",
        },
      ],
      reasonCodes: ["graph_unavailable", "plan_check_complete"],
    }),
    truncated: false,
    redacted: false,
  };
}

async function loadImportanceRecord(
  repoGraphs: RepositoryGraphPort,
): Promise<Record<string, number> | undefined> {
  if (!repoGraphs.loadImportanceByRelativePath) return undefined;
  const loaded = await repoGraphs.loadImportanceByRelativePath();
  if (!loaded) return undefined;
  if (
    typeof (loaded as ReadonlyMap<string, number>).entries === "function" &&
    typeof (loaded as ReadonlyMap<string, number>).get === "function"
  ) {
    return Object.fromEntries(
      (loaded as ReadonlyMap<string, number>).entries(),
    );
  }
  return { ...(loaded as Readonly<Record<string, number>>) };
}

function selectGraph(
  graphs: readonly RepoGraph[],
  seedPath: string,
): RepoGraph | undefined {
  const normalized = seedPath.replace(/\\/g, "/").replace(/^\/+/, "");
  for (const graph of graphs) {
    for (const node of graph.nodes) {
      if (node.kind === "file" && node.relativePath === normalized) {
        return graph;
      }
    }
  }
  return undefined;
}
