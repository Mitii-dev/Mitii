import { CHANGE_IMPACT_POLICY } from "../policy";

export type ModelFacingAffectedNode = {
  path: string;
  symbolName?: string;
  symbolKind?: string;
  hop: number;
  viaEdgeType: string;
  score: number;
  evidence?: readonly string[];
};

export type ModelFacingAffectedFile = {
  path: string;
  hop: number;
  score: number;
  affectedNodeCount: number;
  reason: string;
};

export type ModelFacingPackage = {
  name: string;
  projectId: string;
  hop: number;
  viaEdgeType?: string;
};

/**
 * Prefer affectedFiles for sequencing; keep a score-ranked node slice with
 * short evidence so tool-result budgets do not mangle the blast-radius signal.
 */
export function compactChangeImpactForModelFacing(params: {
  affected: ReadonlyArray<ModelFacingAffectedNode>;
  affectedFiles: ReadonlyArray<ModelFacingAffectedFile>;
  packagesAffected: ReadonlyArray<ModelFacingPackage>;
  maxAffectedNodes?: number;
  maxEvidencePerNode?: number;
  maxAffectedFiles?: number;
}): {
  affected: Array<{
    path: string;
    symbolName?: string;
    symbolKind?: string;
    hop: number;
    viaEdgeType: string;
    score: number;
    evidence?: string[];
  }>;
  affectedFiles: Array<{
    path: string;
    hop: number;
    score: number;
    affectedNodeCount: number;
    reason: string;
  }>;
  packagesAffected: Array<{
    name: string;
    projectId: string;
    hop: number;
    viaEdgeType?: string;
  }>;
  totalAffectedNodes: number;
  totalAffectedFiles: number;
  modelFacingTruncated: boolean;
} {
  const maxNodes =
    params.maxAffectedNodes ?? CHANGE_IMPACT_POLICY.modelFacingAffectedNodes;
  const maxEvidence =
    params.maxEvidencePerNode ??
    CHANGE_IMPACT_POLICY.modelFacingEvidencePerNode;
  const maxFiles =
    params.maxAffectedFiles ?? CHANGE_IMPACT_POLICY.modelFacingAffectedFiles;

  const sortedFiles = [...params.affectedFiles].sort((left, right) => {
    if (left.hop !== right.hop) {
      return left.hop - right.hop;
    }
    return right.score - left.score;
  });
  const sortedNodes = [...params.affected].sort((left, right) => {
    if (left.hop !== right.hop) {
      return left.hop - right.hop;
    }
    return right.score - left.score;
  });

  const affectedFiles = sortedFiles.slice(0, maxFiles);
  const affected = sortedNodes.slice(0, maxNodes).map((node) => ({
    path: node.path,
    ...(node.symbolName ? { symbolName: node.symbolName } : {}),
    ...(node.symbolKind ? { symbolKind: node.symbolKind } : {}),
    hop: node.hop,
    viaEdgeType: node.viaEdgeType,
    score: node.score,
    ...(node.evidence && node.evidence.length > 0
      ? { evidence: [...node.evidence].slice(0, maxEvidence) }
      : {}),
  }));

  const modelFacingTruncated =
    sortedFiles.length > affectedFiles.length ||
    sortedNodes.length > affected.length ||
    params.affected.some(
      (node) => (node.evidence?.length ?? 0) > maxEvidence,
    );

  return {
    affected,
    affectedFiles,
    packagesAffected: [...params.packagesAffected].slice(
      0,
      CHANGE_IMPACT_POLICY.maximumPackages,
    ),
    totalAffectedNodes: params.affected.length,
    totalAffectedFiles: params.affectedFiles.length,
    modelFacingTruncated,
  };
}

/** True when `output` looks like analyze_change_impact tool output. */
export function isChangeImpactToolOutput(
  output: unknown,
): output is {
  affected?: ReadonlyArray<ModelFacingAffectedNode>;
  affectedFiles?: ReadonlyArray<ModelFacingAffectedFile>;
  packagesAffected?: ReadonlyArray<ModelFacingPackage>;
  [key: string]: unknown;
} {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return false;
  }
  const record = output as Record<string, unknown>;
  return (
    Array.isArray(record.affectedFiles) ||
    (Array.isArray(record.affected) &&
      typeof record.provider === "string" &&
      record.provider === "repo_graph")
  );
}
