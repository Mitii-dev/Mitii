import {
  CHANGE_IMPACT_SCHEMA_VERSION,
  ChangeImpactPipeline,
} from "../../../modules/change-impact";
import {
  PLANNING_WORKING_SET_POLICY,
  type PlanningImpactReport,
} from "../../../modules/planning";
import type { RepoGraph } from "../../../modules/repository-state";
import type { RepositoryGraphPort } from "../../tool-runtime";

/**
 * Bounded hop-1 graph reports for follow_evidence planning.
 * Skips silently when the port, graphs, or seeds are missing, or the graph
 * is stale. Never invents paths.
 */
export async function collectPlanningImpactReports(params: {
  repoGraphs?: RepositoryGraphPort;
  seedPaths: readonly string[];
}): Promise<PlanningImpactReport[]> {
  if (!params.repoGraphs) {
    return [];
  }

  const seedPaths = uniquePaths(params.seedPaths).slice(
    0,
    PLANNING_WORKING_SET_POLICY.maxReports,
  );
  if (seedPaths.length === 0) {
    return [];
  }

  try {
    const graphs = await params.repoGraphs.loadGraphs();
    if (graphs.length === 0) {
      return [];
    }

    const pipeline = new ChangeImpactPipeline();
    const reports: PlanningImpactReport[] = [];

    for (const seedPath of seedPaths) {
      const graph = selectGraph(graphs, seedPath) ?? graphs[0];
      if (!graph) continue;

      let expectedToken: string | undefined;
      if (params.repoGraphs.expectedCodeIndexChangeToken) {
        expectedToken =
          await params.repoGraphs.expectedCodeIndexChangeToken(graph);
      }
      if (
        expectedToken &&
        graph.codeIndexChangeToken &&
        expectedToken !== graph.codeIndexChangeToken
      ) {
        continue;
      }

      const mustRead = walkPaths({
        pipeline,
        graph,
        seedPath,
        direction: "dependencies",
        edgeTypes: PLANNING_WORKING_SET_POLICY.dependencyEdgeTypes,
        expectedToken,
      });
      const affected = walkPaths({
        pipeline,
        graph,
        seedPath,
        direction: "dependents",
        edgeTypes: PLANNING_WORKING_SET_POLICY.dependentEdgeTypes,
        expectedToken,
      });
      const writeKey = normalizePath(seedPath);
      const report: PlanningImpactReport = {
        seedPath: writeKey,
        mustRead: mustRead
          .filter((path) => path !== writeKey)
          .slice(0, PLANNING_WORKING_SET_POLICY.maxMustRead),
        affected: affected
          .filter((path) => path !== writeKey && !mustRead.includes(path))
          .slice(0, PLANNING_WORKING_SET_POLICY.maxAffected),
      };
      if (report.mustRead.length === 0 && report.affected.length === 0) {
        continue;
      }
      reports.push(report);
    }

    return reports;
  } catch {
    return [];
  }
}

function walkPaths(params: {
  pipeline: ChangeImpactPipeline;
  graph: RepoGraph;
  seedPath: string;
  direction: "dependents" | "dependencies";
  edgeTypes: readonly ("imports" | "depends_on" | "calls" | "references")[];
  expectedToken?: string;
}): string[] {
  const result = params.pipeline.analyze({
    schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
    seed: { kind: "file", relativePath: params.seedPath },
    direction: params.direction,
    edgeTypes: [...params.edgeTypes],
    maximumHops: PLANNING_WORKING_SET_POLICY.maximumHops,
    maximumAffectedNodes: PLANNING_WORKING_SET_POLICY.maximumAffectedNodes,
    includePackages: false,
    repoGraph: params.graph,
    ...(params.expectedToken
      ? { codeIndexChangeToken: params.expectedToken }
      : {}),
  });
  if (
    result.reasonCodes.includes("graph_stale") ||
    result.reasonCodes.includes("graph_unavailable") ||
    result.reasonCodes.includes("seed_unresolved")
  ) {
    return [];
  }
  return uniquePaths(
    result.affectedFiles
      .filter((file) => file.hop === 1)
      .map((file) => file.relativePath),
  );
}

function selectGraph(
  graphs: readonly RepoGraph[],
  path: string,
): RepoGraph | undefined {
  const normalized = normalizePath(path);
  return graphs.find((graph) =>
    graph.nodes.some(
      (node) =>
        node.kind === "file" && normalizePath(node.relativePath) === normalized,
    ),
  );
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const path of paths) {
    const normalized = normalizePath(path);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function normalizePath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}
