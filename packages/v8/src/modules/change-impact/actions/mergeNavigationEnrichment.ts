import { CHANGE_IMPACT_POLICY } from "../policy";
import {
  bucketSortKey,
  classifyImpactBucket,
} from "../internal/classifyImpactBucket";
import type { ChangeImpactResult } from "../contracts";

export type NavigationEnrichmentLocation = {
  relativePath: string;
  line?: number;
  symbolName?: string;
};

/**
 * Merge live code-nav / LSP locations into an impact result without replacing
 * the graph walk. Used when the published graph is empty/partial for the seed.
 */
export function mergeNavigationEnrichment(params: {
  result: ChangeImpactResult;
  locations: readonly NavigationEnrichmentLocation[];
  viaEdgeType?: "references" | "calls";
  maxFiles?: number;
}): ChangeImpactResult {
  const maxFiles =
    params.maxFiles ?? CHANGE_IMPACT_POLICY.lspEnrichMaxFiles;
  const viaEdgeType = params.viaEdgeType ?? "references";
  const seedPath =
    params.result.seed.kind === "file" ||
    params.result.seed.kind === "symbol" ||
    params.result.seed.kind === "caret"
      ? normalizePath(params.result.seed.relativePath)
      : undefined;

  const existingPaths = new Set(
    params.result.affectedFiles.map((file) => normalizePath(file.relativePath)),
  );
  if (seedPath) existingPaths.add(seedPath);

  const additions: ChangeImpactResult["affectedFiles"] = [];
  for (const location of params.locations) {
    const path = normalizePath(location.relativePath);
    if (!path || existingPaths.has(path)) continue;
    existingPaths.add(path);
    additions.push({
      relativePath: path,
      hop: 1,
      score: 0.55,
      affectedNodeIds: [`nav:${path}`],
      reason: `${viaEdgeType} via code-navigation enrichment`,
      bucket: classifyImpactBucket(path),
    });
    if (additions.length >= maxFiles) break;
  }

  if (additions.length === 0) {
    return params.result;
  }

  const affectedFiles = [...params.result.affectedFiles, ...additions].sort(
    (left, right) =>
      left.hop - right.hop ||
      bucketSortKey(left.bucket) - bucketSortKey(right.bucket) ||
      right.score - left.score ||
      left.relativePath.localeCompare(right.relativePath),
  );

  const affected = [
    ...params.result.affected,
    ...additions.map((file) => ({
      nodeId: file.affectedNodeIds[0]!,
      kind: "file" as const,
      relativePath: file.relativePath,
      hop: 1,
      viaEdgeType,
      score: file.score,
      evidence: [`code_navigation: ${viaEdgeType}`],
    })),
  ];

  const reasonCodes = new Set(params.result.reasonCodes);
  reasonCodes.delete("no_dependents");
  reasonCodes.delete("no_dependencies");
  reasonCodes.add("lsp_enriched");
  reasonCodes.add("impact_resolved");

  const warnings = [
    ...params.result.warnings,
    {
      code: "lsp_enriched" as const,
      message: `Merged ${additions.length} path(s) from code-navigation enrichment.`,
    },
  ];

  const status =
    params.result.status === "unavailable"
      ? params.result.status
      : params.result.truncated ||
          params.result.reasonCodes.includes("graph_stale") ||
          params.result.warnings.some((warning) => warning.code === "graph_partial")
        ? "partial"
        : "ok";

  return {
    ...params.result,
    status,
    affected,
    affectedFiles,
    directNeighborCounts: {
      nodes: Math.max(
        params.result.directNeighborCounts.nodes,
        additions.length,
      ),
      files: Math.max(
        params.result.directNeighborCounts.files,
        new Set(affectedFiles.filter((file) => file.hop === 1).map((f) => f.relativePath))
          .size,
      ),
    },
    warnings,
    reasonCodes: [...reasonCodes],
  };
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}
