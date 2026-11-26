import { compactChangeImpactForModelFacing } from "../../../modules/change-impact";

export function budgetChangeImpactOutput(
  record: Record<string, unknown>,
  maxChars: number,
): { output: unknown; truncated: boolean } {
  const affected = Array.isArray(record.affected)
    ? (record.affected as Array<{
        path: string;
        symbolName?: string;
        symbolKind?: string;
        hop: number;
        viaEdgeType: string;
        score: number;
        evidence?: readonly string[];
      }>)
    : [];
  const affectedFiles = Array.isArray(record.affectedFiles)
    ? (record.affectedFiles as Array<{
        path: string;
        hop: number;
        score: number;
        affectedNodeCount: number;
        reason: string;
      }>)
    : [];
  const packagesAffected = Array.isArray(record.packagesAffected)
    ? (record.packagesAffected as Array<{
        name: string;
        projectId: string;
        hop: number;
        viaEdgeType?: string;
      }>)
    : [];

  let maxNodes = compactChangeImpactForModelFacing({
    affected,
    affectedFiles,
    packagesAffected,
  }).affected.length;
  let maxFiles = compactChangeImpactForModelFacing({
    affected,
    affectedFiles,
    packagesAffected,
  }).affectedFiles.length;
  let maxEvidence = 2;
  let truncated = false;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const slim = compactChangeImpactForModelFacing({
      affected,
      affectedFiles,
      packagesAffected,
      maxAffectedNodes: maxNodes,
      maxEvidencePerNode: maxEvidence,
      maxAffectedFiles: maxFiles,
    });
    const candidate: Record<string, unknown> = {
      ...record,
      affected: slim.affected,
      affectedFiles: slim.affectedFiles,
      packagesAffected: slim.packagesAffected,
      truncated: Boolean(record.truncated) || slim.modelFacingTruncated || truncated,
      ...(slim.modelFacingTruncated || truncated
        ? {
            modelFacingTotalAffectedNodes: slim.totalAffectedNodes,
            modelFacingTotalAffectedFiles: slim.totalAffectedFiles,
          }
        : {}),
    };
    const serialized = JSON.stringify(candidate);
    if (serialized.length <= maxChars) {
      return {
        output: candidate,
        truncated: Boolean(candidate.truncated),
      };
    }
    truncated = true;
    if (maxNodes > 4) {
      maxNodes = Math.max(4, Math.floor(maxNodes / 2));
      maxEvidence = 1;
      continue;
    }
    if (maxFiles > 8) {
      maxFiles = Math.max(8, Math.floor(maxFiles / 2));
      continue;
    }
    break;
  }

  const slim = compactChangeImpactForModelFacing({
    affected,
    affectedFiles,
    packagesAffected,
    maxAffectedNodes: 0,
    maxEvidencePerNode: 0,
    maxAffectedFiles: Math.min(12, maxFiles),
  });
  return {
    output: {
      path: record.path,
      provider: record.provider,
      status: record.status,
      resolvedSeeds: record.resolvedSeeds,
      affected: [],
      affectedFiles: slim.affectedFiles,
      packagesAffected: [],
      truncated: true,
      warnings: record.warnings,
      reasonCodes: [
        ...(Array.isArray(record.reasonCodes)
          ? (record.reasonCodes as string[])
          : []),
        "model_facing_budget_files_only",
      ],
      modelFacingTotalAffectedNodes: slim.totalAffectedNodes,
      modelFacingTotalAffectedFiles: slim.totalAffectedFiles,
    },
    truncated: true,
  };
}

