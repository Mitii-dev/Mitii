import {
  CHANGE_IMPACT_SCHEMA_VERSION,
} from "../constants";
import {
  ChangeImpactError,
  changeImpactMergedResultSchema,
} from "../contracts";
import type {
  ChangeImpactBlastLevel,
  ChangeImpactMergedResult,
  ChangeImpactResult,
  ChangeImpactRiskTier,
  ChangeImpactStatus,
} from "../contracts";
import {
  bucketSortKey,
  classifyImpactBucket,
} from "../internal/classifyImpactBucket";
import { normalizeRelativePath } from "../internal/impactGraphHelpers";

const STATUS_RANK: Record<ChangeImpactStatus, number> = {
  unavailable: 3,
  partial: 2,
  ok: 1,
  empty: 0,
};

const LEVEL_RANK: Record<ChangeImpactBlastLevel, number> = {
  high: 2,
  medium: 1,
  low: 0,
};

const TIER_RANK: Record<ChangeImpactRiskTier, number> = {
  critical: 3,
  test: 2,
  review: 1,
  safe: 0,
};

/**
 * Conservatively merge multiple single-seed impact results.
 * Min confidence, max risk, union of files/packages/cycles/hidden coupling.
 */
export function mergeChangeImpactResults(params: {
  results: readonly ChangeImpactResult[];
}): ChangeImpactMergedResult {
  if (params.results.length === 0) {
    throw new ChangeImpactError(
      "invalid_input",
      "At least one change-impact result is required to merge.",
    );
  }

  const results = params.results;
  const primary = results[0]!;
  const status = worstStatus(results.map((result) => result.status));
  const confidence = Math.min(...results.map((result) => result.confidence));
  const graphConfidenceUnsafe = results.some(
    (result) => result.graphConfidenceUnsafe,
  );
  const truncated = results.some((result) => result.truncated);

  const affectedFiles = mergeAffectedFiles(results);
  const packagesAffected = mergePackages(results);
  const cycles = mergeCycles(results);
  const hiddenCoupling = mergeHiddenCoupling(results);
  const chains = [...results.flatMap((result) => result.chains)]
    .sort((left, right) => left.hop - right.hop || right.score - left.score)
    .slice(0, primary.chains.length > 0 ? Math.max(48, primary.chains.length) : 48);

  const reasonCodes = new Set(
    results.flatMap((result) => result.reasonCodes),
  );
  reasonCodes.add("multi_seed_merged");
  if (
    !reasonCodes.has("impact_resolved") &&
    (affectedFiles.length > 0 || packagesAffected.length > 0)
  ) {
    reasonCodes.add("impact_resolved");
  }

  const warnings = [
    ...results.flatMap((result) => result.warnings),
    {
      code: "multi_seed_merged" as const,
      message: `Merged ${results.length} seed impact result(s).`,
    },
  ];

  const blastRadius = mergeBlastRadius(results, {
    affectedFileCount: affectedFiles.length,
    hop1FileCount: Math.max(
      ...results.map((result) => result.directNeighborCounts.files),
      0,
    ),
  });

  const confidenceNotes = results
    .map((result) => result.confidenceNote)
    .filter((note): note is string => Boolean(note));

  return changeImpactMergedResultSchema.parse({
    schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
    status,
    direction: primary.direction,
    seed: primary.seed,
    resolvedSeeds: dedupeResolvedSeeds(
      results.flatMap((result) => result.resolvedSeeds),
    ),
    affected: mergeAffectedNodes(results),
    affectedFiles,
    packagesAffected,
    chains,
    cycles,
    hiddenCoupling,
    directNeighborCounts: {
      nodes: Math.max(
        ...results.map((result) => result.directNeighborCounts.nodes),
        0,
      ),
      files: Math.max(
        ...results.map((result) => result.directNeighborCounts.files),
        0,
      ),
    },
    totals: {
      affectedNodes: mergeAffectedNodes(results).length,
      affectedFiles: affectedFiles.length,
      packages: packagesAffected.length,
      chains: chains.length,
    },
    confidence,
    ...(confidenceNotes.length > 0
      ? { confidenceNote: confidenceNotes.join("; ") }
      : {}),
    graphConfidenceUnsafe,
    blastRadius,
    truncated,
    warnings,
    reasonCodes: [...reasonCodes],
    ...(primary.graphRevision
      ? { graphRevision: primary.graphRevision }
      : {}),
    ...(primary.codeIndexChangeToken
      ? { codeIndexChangeToken: primary.codeIndexChangeToken }
      : {}),
    seedCount: results.length,
    seedResultsTruncated: false,
  });
}

function worstStatus(
  statuses: readonly ChangeImpactStatus[],
): ChangeImpactStatus {
  return statuses.reduce((worst, status) =>
    STATUS_RANK[status] > STATUS_RANK[worst] ? status : worst,
  );
}

function mergeBlastRadius(
  results: readonly ChangeImpactResult[],
  counts: { affectedFileCount: number; hop1FileCount: number },
): ChangeImpactResult["blastRadius"] {
  const worst = results.reduce((best, result) => {
    if (result.blastRadius.riskScore > best.blastRadius.riskScore) {
      return result;
    }
    if (
      result.blastRadius.riskScore === best.blastRadius.riskScore &&
      LEVEL_RANK[result.blastRadius.level] > LEVEL_RANK[best.blastRadius.level]
    ) {
      return result;
    }
    return best;
  }, results[0]!);

  const maxFragility = Math.max(
    ...results.map((result) => result.blastRadius.fragility),
  );
  const worstTier = results.reduce(
    (tier, result) =>
      TIER_RANK[result.blastRadius.riskTier] > TIER_RANK[tier]
        ? result.blastRadius.riskTier
        : tier,
    worst.blastRadius.riskTier,
  );
  const worstLevel = results.reduce(
    (level, result) =>
      LEVEL_RANK[result.blastRadius.level] > LEVEL_RANK[level]
        ? result.blastRadius.level
        : level,
    worst.blastRadius.level,
  );

  return {
    level: worstLevel,
    fragility: Number(maxFragility.toFixed(3)),
    riskScore: worst.blastRadius.riskScore,
    riskTier: worstTier,
    detail: `${counts.affectedFileCount} affected file(s); ${counts.hop1FileCount} hop-1 file(s); fragility ${maxFragility.toFixed(2)}; merged ${results.length} seed(s)`,
  };
}

function mergeAffectedFiles(
  results: readonly ChangeImpactResult[],
): ChangeImpactResult["affectedFiles"] {
  const byPath = new Map<string, ChangeImpactResult["affectedFiles"][number]>();
  for (const result of results) {
    for (const file of result.affectedFiles) {
      const key = normalizeRelativePath(file.relativePath);
      const current = byPath.get(key);
      if (!current) {
        byPath.set(key, {
          ...file,
          affectedNodeIds: [...file.affectedNodeIds],
        });
        continue;
      }
      current.affectedNodeIds = uniqueStrings([
        ...current.affectedNodeIds,
        ...file.affectedNodeIds,
      ]);
      if (file.hop < current.hop) {
        current.hop = file.hop;
        current.impactReason = file.impactReason;
        current.reason = file.reason;
      }
      current.score = Math.max(current.score, file.score);
    }
  }
  return [...byPath.values()].sort(
    (left, right) =>
      left.hop - right.hop ||
      bucketSortKey(left.bucket ?? classifyImpactBucket(left.relativePath)) -
        bucketSortKey(right.bucket ?? classifyImpactBucket(right.relativePath)) ||
      right.score - left.score ||
      left.relativePath.localeCompare(right.relativePath),
  );
}

function mergeAffectedNodes(
  results: readonly ChangeImpactResult[],
): ChangeImpactResult["affected"] {
  const byId = new Map<string, ChangeImpactResult["affected"][number]>();
  for (const result of results) {
    for (const node of result.affected) {
      const current = byId.get(node.nodeId);
      if (!current || node.hop < current.hop || node.score > current.score) {
        byId.set(node.nodeId, node);
      }
    }
  }
  return [...byId.values()].sort(
    (left, right) =>
      left.hop - right.hop ||
      right.score - left.score ||
      left.relativePath.localeCompare(right.relativePath),
  );
}

function mergePackages(
  results: readonly ChangeImpactResult[],
): ChangeImpactResult["packagesAffected"] {
  const byId = new Map<
    string,
    ChangeImpactResult["packagesAffected"][number]
  >();
  for (const result of results) {
    for (const project of result.packagesAffected) {
      const current = byId.get(project.projectId);
      if (!current || project.hop < current.hop) {
        byId.set(project.projectId, project);
      }
    }
  }
  return [...byId.values()].sort(
    (left, right) =>
      left.hop - right.hop || left.name.localeCompare(right.name),
  );
}

function mergeCycles(results: readonly ChangeImpactResult[]): string[][] {
  const seen = new Set<string>();
  const cycles: string[][] = [];
  for (const result of results) {
    for (const cycle of result.cycles) {
      const key = cycle.join("\u0000");
      if (seen.has(key)) continue;
      seen.add(key);
      cycles.push(cycle);
    }
  }
  return cycles.slice(0, 16);
}

function mergeHiddenCoupling(
  results: readonly ChangeImpactResult[],
): ChangeImpactResult["hiddenCoupling"] {
  const byPath = new Map<
    string,
    ChangeImpactResult["hiddenCoupling"][number]
  >();
  for (const result of results) {
    for (const entry of result.hiddenCoupling) {
      const key = normalizeRelativePath(entry.relativePath);
      const current = byPath.get(key);
      if (!current || entry.coChangeCount > current.coChangeCount) {
        byPath.set(key, entry);
      }
    }
  }
  return [...byPath.values()].sort((left, right) =>
    right.coChangeCount - left.coChangeCount ||
    left.relativePath.localeCompare(right.relativePath),
  );
}

function dedupeResolvedSeeds(
  seeds: ChangeImpactResult["resolvedSeeds"],
): ChangeImpactResult["resolvedSeeds"] {
  const seen = new Set<string>();
  const result: ChangeImpactResult["resolvedSeeds"] = [];
  for (const seed of seeds) {
    if (seen.has(seed.nodeId)) continue;
    seen.add(seed.nodeId);
    result.push(seed);
  }
  return result;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
