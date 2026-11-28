import type {
  ChangeImpactReasonCode,
  ChangeImpactResult,
  ChangeImpactWarningCode,
  ChangeImpactHistoricalCouplingEntry,
} from "../../contracts";
import {
  CHANGE_IMPACT_MESSAGES,
  CHANGE_IMPACT_REASON,
} from "../../constants";
import { applyHistoricalCoupling } from "../../helpers/applyHistoricalCoupling";
import { detectSeedCycles } from "../../helpers/detectSeedCycles";
import type { ResolvedSeedNode } from "../../helpers/impactTypes";
import { resolveEffectiveEdgeTypes } from "../../helpers/resolveEffectiveEdgeTypes";
import type {
  RepoGraph,
  RepoGraphFileNode,
  RepoGraphNode,
} from "../../../repository-state";

export type CouplingCyclesResult = {
  affectedFiles: ChangeImpactResult["affectedFiles"];
  hiddenCoupling: ChangeImpactResult["hiddenCoupling"];
  cycles: ChangeImpactResult["cycles"];
  warnings: Array<{ code: ChangeImpactWarningCode; message: string }>;
  reasonCodes: ChangeImpactReasonCode[];
};

/**
 * Flow step 4: historical co-change boosts + seed-neighborhood cycles.
 */
export function applyChangeImpactCouplingCycles(params: {
  graph: RepoGraph;
  seedRelativePath: string | undefined;
  resolvedSeeds: readonly ResolvedSeedNode[];
  affectedFiles: ChangeImpactResult["affectedFiles"];
  structuralNeighborPaths: ReadonlySet<string>;
  coupling: readonly ChangeImpactHistoricalCouplingEntry[];
  edgeTypes: ChangeImpactParsedEdgeTypes;
  includePackages: boolean;
  nodeById: ReadonlyMap<string, RepoGraphNode>;
  fileByFileId: ReadonlyMap<string, RepoGraphFileNode>;
}): CouplingCyclesResult {
  const warnings: Array<{
    code: ChangeImpactWarningCode;
    message: string;
  }> = [];
  const reasonCodes: ChangeImpactReasonCode[] = [];

  const coupling = applyHistoricalCoupling({
    seedRelativePath: params.seedRelativePath,
    affectedFiles: params.affectedFiles,
    coupling: params.coupling,
    structuralNeighborPaths: params.structuralNeighborPaths,
  });
  reasonCodes.push(...coupling.reasonCodes);
  warnings.push(...coupling.warnings);

  const edgeTypes = resolveEffectiveEdgeTypes({
    edgeTypes: params.edgeTypes,
    includePackages: params.includePackages,
  });
  const cycles = detectSeedCycles({
    graph: params.graph,
    seedNodeIds: params.resolvedSeeds.map((seed) => seed.node.id),
    edgeTypes,
    nodeById: params.nodeById,
    fileByFileId: params.fileByFileId,
  });
  if (cycles.length > 0) {
    reasonCodes.push(CHANGE_IMPACT_REASON.seedCycleDetected);
    warnings.push({
      code: "seed_cycle_detected",
      message: CHANGE_IMPACT_MESSAGES.seedCyclesDetected(cycles.length),
    });
  }

  return {
    affectedFiles: coupling.affectedFiles,
    hiddenCoupling: coupling.hiddenCoupling,
    cycles,
    warnings,
    reasonCodes,
  };
}

type ChangeImpactParsedEdgeTypes =
  import("../../contracts").ChangeImpactParsedInput["edgeTypes"];
