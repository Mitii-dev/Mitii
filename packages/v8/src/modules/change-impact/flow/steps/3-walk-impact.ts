import type {
  ChangeImpactParsedInput,
  ChangeImpactReasonCode,
  ChangeImpactResult,
  ChangeImpactWarningCode,
} from "../../contracts";
import { CHANGE_IMPACT_POLICY } from "../../rules";
import { countSeedNeighborhood } from "../../helpers/countSeedNeighborhood";
import { normalizeRelativePath } from "../../helpers/impactGraphHelpers";
import type { ResolvedSeedNode } from "../../helpers/impactTypes";
import { resolveEffectiveEdgeTypes } from "../../helpers/resolveEffectiveEdgeTypes";
import {
  aggregateAffectedFiles,
  countDirectNeighbors,
  runImpactWalk,
  toAffectedNodes,
  toAffectedPackages,
  toChains,
} from "../../helpers/runImpactWalk";
import type {
  RepoGraphFileNode,
  RepoGraphNode,
} from "../../../repository-state";

export type WalkImpactResult = {
  affected: ChangeImpactResult["affected"];
  affectedFiles: ChangeImpactResult["affectedFiles"];
  packagesAffected: ChangeImpactResult["packagesAffected"];
  chains: ChangeImpactResult["chains"];
  directNeighborCounts: ChangeImpactResult["directNeighborCounts"];
  neighborhood: { outFiles: number; inFiles: number };
  structuralNeighborPaths: Set<string>;
  truncated: boolean;
  reasonCodes: ChangeImpactReasonCode[];
};

/**
 * Flow step 3: bounded dependents/dependencies walk + aggregation.
 */
export function walkChangeImpact(params: {
  input: ChangeImpactParsedInput;
  resolvedSeeds: readonly ResolvedSeedNode[];
  nodeById: ReadonlyMap<string, RepoGraphNode>;
  fileByFileId: ReadonlyMap<string, RepoGraphFileNode>;
  warnings: Array<{ code: ChangeImpactWarningCode; message: string }>;
}): WalkImpactResult {
  const edgeTypes = resolveEffectiveEdgeTypes({
    edgeTypes: params.input.edgeTypes,
    includePackages: params.input.includePackages,
  });

  const walk = runImpactWalk({
    graph: params.input.repoGraph,
    seedNodeIds: params.resolvedSeeds.map((seed) => seed.node.id),
    edgeTypes,
    maximumHops: params.input.maximumHops,
    maximumAffectedNodes: params.input.maximumAffectedNodes,
    maximumPaths: params.input.maximumPaths,
    nodeById: params.nodeById,
    fileByFileId: params.fileByFileId,
    importanceByRelativePath: params.input.importanceByRelativePath,
    reverse: params.input.direction !== "dependencies",
  });

  const affected = toAffectedNodes({
    visits: walk.visits,
    nodeById: params.nodeById,
    fileByFileId: params.fileByFileId,
    warnings: params.warnings,
  });
  const affectedFiles = aggregateAffectedFiles(affected);
  const packagesAffected = params.input.includePackages
    ? toAffectedPackages({
        visits: walk.visits,
        nodeById: params.nodeById,
        maximumPackages: CHANGE_IMPACT_POLICY.maximumPackages,
      })
    : [];
  const chains = toChains({
    rawChains: walk.chains,
    nodeById: params.nodeById,
    fileByFileId: params.fileByFileId,
  });
  const directNeighborCounts = countDirectNeighbors({
    visits: walk.visits,
    nodeById: params.nodeById,
    fileByFileId: params.fileByFileId,
  });
  const neighborhood = countSeedNeighborhood({
    graph: params.input.repoGraph,
    seedNodeIds: params.resolvedSeeds.map((seed) => seed.node.id),
    edgeTypes,
    nodeById: params.nodeById,
    fileByFileId: params.fileByFileId,
  });

  return {
    affected,
    affectedFiles,
    packagesAffected,
    chains,
    directNeighborCounts,
    neighborhood,
    structuralNeighborPaths: new Set(
      affectedFiles.map((file) => normalizeRelativePath(file.relativePath)),
    ),
    truncated: walk.truncated,
    reasonCodes: [...walk.reasonCodes],
  };
}
