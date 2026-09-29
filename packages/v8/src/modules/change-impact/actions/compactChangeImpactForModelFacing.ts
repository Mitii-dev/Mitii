import {
  bucketSortKey,
  classifyImpactBucket,
  type ChangeImpactFileBucket,
} from "../internal/classifyImpactBucket";
import { collapseChainPrefixes } from "../internal/collectBoundedChains";
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
  bucket?: ChangeImpactFileBucket;
};

export type ModelFacingPackage = {
  name: string;
  projectId: string;
  hop: number;
  viaEdgeType?: string;
};

export type ModelFacingChainLink = {
  path?: string;
  symbolName?: string;
  nodeId?: string;
};

export type ModelFacingChain = {
  links: readonly ModelFacingChainLink[];
  hop: number;
  score: number;
  viaEdgeType?: string;
};

/**
 * Prefer affectedFiles for sequencing; keep a score-ranked node slice with
 * short evidence so tool-result budgets do not mangle the blast-radius signal.
 * Prod-bucket files/nodes rank ahead of test at the same hop.
 * Chains are prefix-collapsed for compact model output.
 */
export function compactChangeImpactForModelFacing(params: {
  affected: ReadonlyArray<ModelFacingAffectedNode>;
  affectedFiles: ReadonlyArray<ModelFacingAffectedFile>;
  packagesAffected: ReadonlyArray<ModelFacingPackage>;
  chains?: ReadonlyArray<ModelFacingChain>;
  maxAffectedNodes?: number;
  maxEvidencePerNode?: number;
  maxAffectedFiles?: number;
  maxChains?: number;
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
    bucket: ChangeImpactFileBucket;
  }>;
  packagesAffected: Array<{
    name: string;
    projectId: string;
    hop: number;
    viaEdgeType?: string;
  }>;
  chains: string[];
  totalAffectedNodes: number;
  totalAffectedFiles: number;
  totalChains: number;
  modelFacingTruncated: boolean;
} {
  const maxNodes =
    params.maxAffectedNodes ?? CHANGE_IMPACT_POLICY.modelFacingAffectedNodes;
  const maxEvidence =
    params.maxEvidencePerNode ??
    CHANGE_IMPACT_POLICY.modelFacingEvidencePerNode;
  const maxFiles =
    params.maxAffectedFiles ?? CHANGE_IMPACT_POLICY.modelFacingAffectedFiles;
  const maxChains =
    params.maxChains ?? CHANGE_IMPACT_POLICY.modelFacingChains;

  const sortedFiles = [...params.affectedFiles]
    .map((file) => ({
      ...file,
      bucket: file.bucket ?? classifyImpactBucket(file.path),
    }))
    .sort((left, right) => {
      if (left.hop !== right.hop) {
        return left.hop - right.hop;
      }
      const bucketDelta =
        bucketSortKey(left.bucket) - bucketSortKey(right.bucket);
      if (bucketDelta !== 0) return bucketDelta;
      return right.score - left.score;
    });
  const sortedNodes = [...params.affected].sort((left, right) => {
    if (left.hop !== right.hop) {
      return left.hop - right.hop;
    }
    const bucketDelta =
      bucketSortKey(classifyImpactBucket(left.path)) -
      bucketSortKey(classifyImpactBucket(right.path));
    if (bucketDelta !== 0) return bucketDelta;
    return right.score - left.score;
  });

  const sortedChains = [...(params.chains ?? [])].sort(
    (left, right) =>
      left.hop - right.hop ||
      right.score - left.score,
  );
  const chainLabels = sortedChains.map((chain) =>
    chain.links
      .map((link) => {
        if (link.path && link.symbolName) {
          return `${link.path}:${link.symbolName}`;
        }
        return link.path ?? link.symbolName ?? link.nodeId ?? "";
      })
      .filter((label) => label.length > 0),
  );
  const collapsed = collapseChainPrefixes(chainLabels);
  const chains = collapsed.slice(0, maxChains);

  const affectedFiles = sortedFiles.slice(0, maxFiles).map((file) => ({
    path: file.path,
    hop: file.hop,
    score: file.score,
    affectedNodeCount: file.affectedNodeCount,
    reason: file.reason,
    bucket: file.bucket,
  }));
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
    collapsed.length > chains.length ||
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
    chains,
    totalAffectedNodes: params.affected.length,
    totalAffectedFiles: params.affectedFiles.length,
    totalChains: params.chains?.length ?? 0,
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
