import type {
  ChangeImpactBlastLevel,
  ChangeImpactBlastRadius,
  ChangeImpactRiskTier,
} from "../contracts";
import { CHANGE_IMPACT_POLICY } from "../policy";
import { classifyImpactBucket } from "./classifyImpactBucket";

export function classifyBlastRadius(params: {
  seedRelativePath?: string;
  affectedFileCount: number;
  hop1FileCount: number;
  /** Fan-out of seed neighborhood (dependencies of seed). */
  seedOutFileCount: number;
  /** Fan-in of seed neighborhood (dependents of seed). */
  seedInFileCount: number;
  hasTestDependent: boolean;
  confidence: number;
  graphConfidenceUnsafe: boolean;
  cycleCount?: number;
  hiddenCouplingCount?: number;
}): ChangeImpactBlastRadius {
  const ca = params.seedInFileCount;
  const ce = params.seedOutFileCount;
  const fragility =
    ca + ce === 0 ? 0 : Number((ce / (ca + ce)).toFixed(3));

  const level = classifyBlastLevel({
    affectedFileCount: params.affectedFileCount,
    hop1FileCount: params.hop1FileCount,
  });

  const riskScore = computeRiskScore({
    seedRelativePath: params.seedRelativePath,
    affectedFileCount: params.affectedFileCount,
    hop1FileCount: params.hop1FileCount,
    fragility,
    hasTestDependent: params.hasTestDependent,
    confidence: params.confidence,
    graphConfidenceUnsafe: params.graphConfidenceUnsafe,
    level,
    cycleCount: params.cycleCount ?? 0,
    hiddenCouplingCount: params.hiddenCouplingCount ?? 0,
  });
  const riskTier = riskTierFromScore(riskScore);

  const detailParts = [
    `${params.affectedFileCount} affected file(s)`,
    `${params.hop1FileCount} hop-1 file(s)`,
    `fragility ${fragility.toFixed(2)}`,
  ];
  if (params.graphConfidenceUnsafe) {
    detailParts.push("graph confidence unsafe");
  }
  if ((params.cycleCount ?? 0) > 0) {
    detailParts.push(`${params.cycleCount} seed cycle(s)`);
  }
  if ((params.hiddenCouplingCount ?? 0) > 0) {
    detailParts.push(`${params.hiddenCouplingCount} hidden coupling(s)`);
  }
  if (!params.hasTestDependent && params.affectedFileCount > 0) {
    detailParts.push("no direct test dependents");
  }

  return {
    level,
    fragility,
    riskScore,
    riskTier,
    detail: detailParts.join("; "),
  };
}

function classifyBlastLevel(params: {
  affectedFileCount: number;
  hop1FileCount: number;
}): ChangeImpactBlastLevel {
  if (
    params.affectedFileCount >= CHANGE_IMPACT_POLICY.blastHighFiles ||
    params.hop1FileCount >= CHANGE_IMPACT_POLICY.blastHighHop1
  ) {
    return "high";
  }
  if (
    params.affectedFileCount >= CHANGE_IMPACT_POLICY.blastMediumFiles ||
    params.hop1FileCount >= CHANGE_IMPACT_POLICY.blastMediumHop1
  ) {
    return "medium";
  }
  return "low";
}

function computeRiskScore(params: {
  seedRelativePath?: string;
  affectedFileCount: number;
  hop1FileCount: number;
  fragility: number;
  hasTestDependent: boolean;
  confidence: number;
  graphConfidenceUnsafe: boolean;
  level: ChangeImpactBlastLevel;
  cycleCount: number;
  hiddenCouplingCount: number;
}): number {
  let score = 10;
  score += Math.min(40, params.hop1FileCount * 2);
  score += Math.min(20, Math.floor(params.affectedFileCount / 2));
  score += Math.round(params.fragility * 15);

  if (params.level === "high") score += 15;
  else if (params.level === "medium") score += 8;

  if (params.graphConfidenceUnsafe) score += 12;
  else if (params.confidence < CHANGE_IMPACT_POLICY.confidenceLow) score += 6;

  if (!params.hasTestDependent && params.affectedFileCount > 0) {
    score += 10;
  } else if (params.hasTestDependent) {
    score = Math.round(score * 0.85);
  }

  if (
    params.seedRelativePath &&
    pathLooksSensitive(params.seedRelativePath)
  ) {
    score += 12;
  }

  score += Math.min(12, params.cycleCount * 4);
  score += Math.min(10, params.hiddenCouplingCount * 2);

  return Math.max(0, Math.min(100, Math.round(score)));
}

function riskTierFromScore(score: number): ChangeImpactRiskTier {
  if (score >= CHANGE_IMPACT_POLICY.riskCritical) return "critical";
  if (score >= CHANGE_IMPACT_POLICY.riskTest) return "test";
  if (score >= CHANGE_IMPACT_POLICY.riskReview) return "review";
  return "safe";
}

export function pathLooksSensitive(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  const segments = normalized.split(/[/_.-]+/);
  return CHANGE_IMPACT_POLICY.sensitivePathTokens.some((token) =>
    segments.includes(token),
  );
}

export function affectedHasTestDependent(
  affectedFiles: ReadonlyArray<{ relativePath: string; bucket?: string }>,
): boolean {
  return affectedFiles.some(
    (file) =>
      (file.bucket ?? classifyImpactBucket(file.relativePath)) === "test",
  );
}
