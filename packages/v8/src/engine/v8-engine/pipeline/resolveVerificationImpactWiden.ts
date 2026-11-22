import {
  CHANGE_IMPACT_SCHEMA_VERSION,
  analyzeManyChangeImpact,
  recommendWidenVerification,
} from "../../../modules/change-impact";
import type { RepositoryGraphPort } from "../../../modules/change-impact";
import type { RepoGraph } from "../../../modules/repository-state";

/**
 * Derive verification widen hints from a prior impact tool result or a
 * bounded multi-seed walk over changed files.
 */
export async function resolveVerificationImpactWiden(params: {
  repoGraphs?: RepositoryGraphPort;
  changedFiles: readonly string[];
  explicitAffectedFiles?: readonly string[];
  explicitWiden?: boolean;
  signal?: AbortSignal;
}): Promise<{
  impactAffectedFiles?: string[];
  widenScope?: boolean;
}> {
  if (params.signal?.aborted) {
    return {};
  }

  if (
    params.explicitAffectedFiles &&
    params.explicitAffectedFiles.length > 0
  ) {
    return {
      impactAffectedFiles: [...params.explicitAffectedFiles],
      widenScope: params.explicitWiden ?? true,
    };
  }

  if (!params.repoGraphs || params.changedFiles.length === 0) {
    return {};
  }

  try {
    const graphs = await params.repoGraphs.loadGraphs();
    if (graphs.length === 0) return {};

    const seeds = uniquePaths(params.changedFiles).slice(0, 16);
    const graph = selectGraph(graphs, seeds[0]!) ?? graphs[0];
    if (!graph) return {};

    let expectedToken: string | undefined;
    if (params.repoGraphs.expectedCodeIndexChangeToken) {
      expectedToken = await params.repoGraphs.expectedCodeIndexChangeToken(
        graph,
      );
    }

    const { merged } = analyzeManyChangeImpact({
      input: {
        schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
        seeds: seeds.map((relativePath) => ({
          kind: "file" as const,
          relativePath,
        })),
        repoGraph: graph,
        includePackages: true,
        maximumHops: 2,
        maximumAffectedNodes: 80,
        ...(expectedToken ? { codeIndexChangeToken: expectedToken } : {}),
      },
    });

    const impactAffectedFiles = uniquePaths(
      merged.affectedFiles.map((file) => file.relativePath),
    );
    const widenScope = recommendWidenVerification(merged);

    if (impactAffectedFiles.length === 0 && !widenScope) {
      return {};
    }

    return {
      ...(impactAffectedFiles.length > 0 ? { impactAffectedFiles } : {}),
      ...(widenScope ? { widenScope: true } : {}),
    };
  } catch {
    return {};
  }
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

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}
