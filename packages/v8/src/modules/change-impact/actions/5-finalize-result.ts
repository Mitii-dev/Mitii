import { CHANGE_IMPACT_REASON, CHANGE_IMPACT_SCHEMA_VERSION } from "../constants";
import {
  changeImpactResultSchema,
  type ChangeImpactParsedInput,
  type ChangeImpactReasonCode,
  type ChangeImpactResult,
  type ChangeImpactWarningCode,
} from "../contracts";
import {
  affectedHasTestDependent,
  classifyBlastRadius,
} from "../internal/classifyBlastRadius";
import type { GraphConfidenceAssessment } from "../internal/computeGraphConfidence";
import type { ResolvedSeedNode } from "../internal/impactTypes";

/**
 * Flow step 5: blast radius, status, reason codes, validated result.
 */
export function finalizeChangeImpactResult(params: {
  input: ChangeImpactParsedInput;
  confidence: GraphConfidenceAssessment;
  seedRelativePath: string | undefined;
  resolvedSeeds: readonly ResolvedSeedNode[];
  affected: ChangeImpactResult["affected"];
  affectedFiles: ChangeImpactResult["affectedFiles"];
  packagesAffected: ChangeImpactResult["packagesAffected"];
  chains: ChangeImpactResult["chains"];
  cycles: ChangeImpactResult["cycles"];
  hiddenCoupling: ChangeImpactResult["hiddenCoupling"];
  directNeighborCounts: ChangeImpactResult["directNeighborCounts"];
  neighborhood: { outFiles: number; inFiles: number };
  truncated: boolean;
  warnings: Array<{ code: ChangeImpactWarningCode; message: string }>;
  reasonCodes: Set<ChangeImpactReasonCode>;
}): ChangeImpactResult {
  const {
    input,
    confidence,
    resolvedSeeds,
    affected,
    affectedFiles,
    packagesAffected,
    chains,
    cycles,
    hiddenCoupling,
    directNeighborCounts,
    neighborhood,
    truncated,
    warnings,
    reasonCodes,
  } = params;

  const hasImpact =
    affected.length > 0 ||
    packagesAffected.length > 0 ||
    hiddenCoupling.length > 0;

  if (hasImpact) {
    reasonCodes.add(CHANGE_IMPACT_REASON.impactResolved);
  } else if (resolvedSeeds.length > 0) {
    reasonCodes.add(
      input.direction === "dependencies"
        ? CHANGE_IMPACT_REASON.noDependencies
        : CHANGE_IMPACT_REASON.noDependents,
    );
  }

  const blastRadius = classifyBlastRadius({
    seedRelativePath: params.seedRelativePath,
    affectedFileCount: affectedFiles.length,
    hop1FileCount: directNeighborCounts.files,
    seedOutFileCount: neighborhood.outFiles,
    seedInFileCount: neighborhood.inFiles,
    hasTestDependent: affectedHasTestDependent(affectedFiles),
    confidence: confidence.confidence,
    graphConfidenceUnsafe: confidence.unsafe,
    cycleCount: cycles.length,
    hiddenCouplingCount: hiddenCoupling.length,
  });

  return changeImpactResultSchema.parse({
    schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
    status: resolveStatus({
      truncated,
      reasonCodes,
      graphPartial: input.repoGraph.status === "partial",
      graphConfidenceUnsafe: confidence.unsafe,
      hasImpact,
    }),
    direction: input.direction,
    seed: input.seed,
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
    cycles,
    hiddenCoupling,
    directNeighborCounts,
    totals: {
      affectedNodes: affected.length,
      affectedFiles: affectedFiles.length,
      packages: packagesAffected.length,
      chains: chains.length,
    },
    confidence: confidence.confidence,
    ...(confidence.note ? { confidenceNote: confidence.note } : {}),
    graphConfidenceUnsafe: confidence.unsafe,
    blastRadius,
    truncated,
    warnings,
    reasonCodes: [...reasonCodes],
    graphRevision: input.repoGraph.workspaceSnapshotId,
    codeIndexChangeToken: input.repoGraph.codeIndexChangeToken,
  });
}

export function buildEmptyChangeImpactResult(params: {
  input: ChangeImpactParsedInput;
  confidence: GraphConfidenceAssessment;
  warnings: Array<{ code: ChangeImpactWarningCode; message: string }>;
  reasonCodes: Set<ChangeImpactReasonCode>;
  seedRelativePath: string | undefined;
}): ChangeImpactResult {
  const blastRadius = classifyBlastRadius({
    seedRelativePath: params.seedRelativePath,
    affectedFileCount: 0,
    hop1FileCount: 0,
    seedOutFileCount: 0,
    seedInFileCount: 0,
    hasTestDependent: false,
    confidence: params.confidence.confidence,
    graphConfidenceUnsafe: params.confidence.unsafe,
  });

  return changeImpactResultSchema.parse({
    schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
    status: resolveStatus({
      truncated: false,
      reasonCodes: params.reasonCodes,
      graphPartial: params.input.repoGraph.status === "partial",
      graphConfidenceUnsafe: params.confidence.unsafe,
      hasImpact: false,
    }),
    direction: params.input.direction,
    seed: params.input.seed,
    resolvedSeeds: [],
    affected: [],
    affectedFiles: [],
    packagesAffected: [],
    chains: [],
    cycles: [],
    hiddenCoupling: [],
    directNeighborCounts: { nodes: 0, files: 0 },
    totals: {
      affectedNodes: 0,
      affectedFiles: 0,
      packages: 0,
      chains: 0,
    },
    confidence: params.confidence.confidence,
    ...(params.confidence.note
      ? { confidenceNote: params.confidence.note }
      : {}),
    graphConfidenceUnsafe: params.confidence.unsafe,
    blastRadius,
    truncated: false,
    warnings: params.warnings,
    reasonCodes: [...params.reasonCodes],
    graphRevision: params.input.repoGraph.workspaceSnapshotId,
    codeIndexChangeToken: params.input.repoGraph.codeIndexChangeToken,
  });
}

function resolveStatus(params: {
  truncated: boolean;
  reasonCodes: ReadonlySet<ChangeImpactReasonCode>;
  graphPartial: boolean;
  graphConfidenceUnsafe: boolean;
  hasImpact: boolean;
}): ChangeImpactResult["status"] {
  if (
    params.truncated ||
    params.reasonCodes.has(CHANGE_IMPACT_REASON.graphStale) ||
    params.graphPartial ||
    params.graphConfidenceUnsafe
  ) {
    return "partial";
  }
  return params.hasImpact ? "ok" : "empty";
}
