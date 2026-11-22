import { CHANGE_IMPACT_POLICY } from "../policy";
import {
  affectedHasTestDependent,
  classifyBlastRadius,
} from "../internal/classifyBlastRadius";
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
  /** Defaults to lsp_enriched; SCIP ingest uses scip_enriched. */
  enrichmentCode?: "lsp_enriched" | "scip_enriched";
}): ChangeImpactResult {
  const enrichmentCode = params.enrichmentCode ?? "lsp_enriched";
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
      impactReason: "navigation_enrichment",
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
  reasonCodes.add(enrichmentCode);
  reasonCodes.add("impact_resolved");

  const warnings = [
    ...params.result.warnings,
    {
      code: enrichmentCode,
      message: `Merged ${additions.length} path(s) from ${enrichmentCode === "scip_enriched" ? "SCIP" : "code-navigation"} enrichment.`,
    },
  ];

  const hop1Files = new Set(
    affectedFiles
      .filter((file) => file.hop === 1)
      .map((file) => file.relativePath),
  ).size;

  const seedInFileCount = Math.max(
    params.result.directNeighborCounts.files,
    hop1Files,
  );
  const priorFragility = params.result.blastRadius.fragility;
  const seedOutFileCount =
    priorFragility > 0 && priorFragility < 1
      ? Math.max(
          0,
          Math.round(
            (priorFragility * seedInFileCount) / (1 - priorFragility),
          ),
        )
      : 0;

  const blastRadius = classifyBlastRadius({
    seedRelativePath: seedPath,
    affectedFileCount: affectedFiles.length,
    hop1FileCount: hop1Files,
    seedOutFileCount,
    seedInFileCount,
    hasTestDependent: affectedHasTestDependent(affectedFiles),
    confidence: params.result.confidence,
    graphConfidenceUnsafe: params.result.graphConfidenceUnsafe,
  });

  const status =
    params.result.status === "unavailable"
      ? params.result.status
      : params.result.truncated ||
          params.result.graphConfidenceUnsafe ||
          params.result.reasonCodes.includes("graph_stale") ||
          params.result.warnings.some(
            (warning) => warning.code === "graph_partial",
          )
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
      files: Math.max(params.result.directNeighborCounts.files, hop1Files),
    },
    totals: {
      affectedNodes: affected.length,
      affectedFiles: affectedFiles.length,
      packages: params.result.packagesAffected.length,
      chains: params.result.chains.length,
    },
    blastRadius,
    warnings,
    reasonCodes: [...reasonCodes],
  };
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}
