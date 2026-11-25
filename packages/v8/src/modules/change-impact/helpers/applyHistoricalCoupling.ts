import type {
  ChangeImpactFileReason,
  ChangeImpactReasonCode,
  ChangeImpactResult,
  ChangeImpactWarningCode,
  ChangeImpactHistoricalCouplingEntry,
} from "../types";
import { CHANGE_IMPACT_POLICY } from "../rules";
import {
  bucketSortKey,
  classifyImpactBucket,
} from "./classifyImpactBucket";
import { normalizeRelativePath } from "./impactGraphHelpers";
import {
  filenamesSharePrefix,
  packageRootFromPath,
} from "./packagePathHelpers";

export type HistoricalCouplingApplication = {
  affectedFiles: ChangeImpactResult["affectedFiles"];
  hiddenCoupling: ChangeImpactResult["hiddenCoupling"];
  reasonCodes: ChangeImpactReasonCode[];
  warnings: Array<{ code: ChangeImpactWarningCode; message: string }>;
};

/**
 * Apply capped host-published co-change signals.
 * - Already-affected files get a bounded score boost.
 * - Non-structural same-package (or prefix-related) pairs may be added only
 *   when co-change evidence clears the hidden-coupling gate.
 */
export function applyHistoricalCoupling(params: {
  seedRelativePath?: string;
  affectedFiles: ChangeImpactResult["affectedFiles"];
  coupling: readonly ChangeImpactHistoricalCouplingEntry[];
  structuralNeighborPaths: ReadonlySet<string>;
}): HistoricalCouplingApplication {
  const reasonCodes: ChangeImpactReasonCode[] = [];
  const warnings: Array<{ code: ChangeImpactWarningCode; message: string }> =
    [];
  if (params.coupling.length === 0) {
    return {
      affectedFiles: params.affectedFiles,
      hiddenCoupling: [],
      reasonCodes,
      warnings,
    };
  }

  const seedPath = params.seedRelativePath
    ? normalizeRelativePath(params.seedRelativePath)
    : undefined;
  const seedPackage = seedPath ? packageRootFromPath(seedPath) : undefined;

  const byPath = new Map(
    params.affectedFiles.map((file) => [
      normalizeRelativePath(file.relativePath),
      { ...file, affectedNodeIds: [...file.affectedNodeIds] },
    ]),
  );

  let boosted = false;
  const hiddenCoupling: ChangeImpactResult["hiddenCoupling"] = [];

  for (const entry of params.coupling) {
    const path = normalizeRelativePath(entry.relativePath);
    if (!path || (seedPath && path === seedPath)) continue;
    const count = Math.max(0, entry.coChangeCount);
    if (count <= 0) continue;

    const existing = byPath.get(path);
    if (existing) {
      const boost = cappedCoChangeBoost(count);
      existing.score = Number((existing.score * boost).toFixed(3));
      if (existing.impactReason !== "hidden_coupling") {
        // Keep structural reason; annotate via score only.
      }
      boosted = true;
      continue;
    }

    if (count < CHANGE_IMPACT_POLICY.hiddenCouplingMin) continue;
    if (
      !passesSiblingEvidenceGate({
        seedPath,
        seedPackage,
        candidatePath: path,
        coChangeCount: count,
        structuralNeighborPaths: params.structuralNeighborPaths,
      })
    ) {
      continue;
    }
    if (hiddenCoupling.length >= CHANGE_IMPACT_POLICY.hiddenCouplingMaxFiles) {
      continue;
    }

    const impactReason: ChangeImpactFileReason = "hidden_coupling";
    const score = Number(
      (
        CHANGE_IMPACT_POLICY.hiddenCouplingBaseScore *
        cappedCoChangeBoost(count)
      ).toFixed(3),
    );
    const file = {
      relativePath: path,
      hop: 1,
      score,
      affectedNodeIds: [`hist:${path}`],
      reason: `hidden coupling co-change=${count}`,
      impactReason,
      bucket: classifyImpactBucket(path),
    };
    byPath.set(path, file);
    hiddenCoupling.push({
      relativePath: path,
      coChangeCount: count,
      ...(typeof entry.churnScore === "number"
        ? { churnScore: entry.churnScore }
        : {}),
      reason: "co-change without structural edge",
    });
  }

  if (boosted) {
    reasonCodes.push("historical_coupling_applied");
    warnings.push({
      code: "historical_coupling_applied",
      message:
        "Applied capped host-published co-change boosts to structural impact files.",
    });
  }
  if (hiddenCoupling.length > 0) {
    reasonCodes.push("hidden_coupling_detected");
    warnings.push({
      code: "hidden_coupling_detected",
      message: `Merged ${hiddenCoupling.length} evidence-gated hidden-coupling file(s).`,
    });
  }

  const affectedFiles = [...byPath.values()].sort(
    (left, right) =>
      left.hop - right.hop ||
      bucketSortKey(left.bucket) - bucketSortKey(right.bucket) ||
      right.score - left.score ||
      left.relativePath.localeCompare(right.relativePath),
  );

  return { affectedFiles, hiddenCoupling, reasonCodes, warnings };
}

export function cappedCoChangeBoost(coChangeCount: number): number {
  const capped = Math.min(
    CHANGE_IMPACT_POLICY.coChangeCountCap,
    Math.max(0, coChangeCount),
  );
  const normalized = capped / CHANGE_IMPACT_POLICY.coChangeCountCap;
  return 1 + CHANGE_IMPACT_POLICY.coChangeWeight * normalized;
}

export function passesSiblingEvidenceGate(params: {
  seedPath?: string;
  seedPackage?: string;
  candidatePath: string;
  coChangeCount: number;
  structuralNeighborPaths: ReadonlySet<string>;
}): boolean {
  if (params.structuralNeighborPaths.has(params.candidatePath)) {
    return true;
  }
  if (params.coChangeCount >= CHANGE_IMPACT_POLICY.hiddenCouplingMin) {
    const candidatePackage = packageRootFromPath(params.candidatePath);
    if (
      params.seedPackage &&
      candidatePackage &&
      params.seedPackage === candidatePackage
    ) {
      return true;
    }
    if (
      params.seedPath &&
      filenamesSharePrefix(params.seedPath, params.candidatePath)
    ) {
      return true;
    }
  }
  // Outside same package / prefix: still allow strong co-change as hidden coupling.
  return params.coChangeCount >= CHANGE_IMPACT_POLICY.hiddenCouplingMin * 2;
}
