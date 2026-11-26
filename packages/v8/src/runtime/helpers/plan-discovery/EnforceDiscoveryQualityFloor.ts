/**
 * File-backed discovery quality floor (S3A-DISCOVER) — thin bar for the pump.
 * Full sufficiency helpers live in PlanDiscoveryQuality (evacuated from engine).
 */

import type { DiscoveryBrief } from "../../../modules/planning";
import {
  countProductiveDiscoveryReads,
  isProductiveDiscoveryReadPath,
} from "./PlanDiscoveryQuality";

export function isProductiveDiscoveryPath(path: string): boolean {
  return isProductiveDiscoveryReadPath(path);
}

export function countProductiveReads(
  filesRead: readonly { path: string }[],
): number {
  return countProductiveDiscoveryReads(filesRead);
}

export interface EnforceDiscoveryQualityFloorInput {
  brief: Pick<
    DiscoveryBrief,
    "filesRead" | "proposedChangeSurfaces" | "confidence"
  >;
  /** Plan mode / thorough agent big-task. */
  requireFloor: boolean;
  minProductiveReads?: number;
  searchCount?: number;
  minSearches?: number;
}

export interface EnforceDiscoveryQualityFloorResult {
  ok: boolean;
  productiveReads: number;
  reasonCodes: string[];
}

export function enforceDiscoveryQualityFloor(
  input: EnforceDiscoveryQualityFloorInput,
): EnforceDiscoveryQualityFloorResult {
  const productiveReads = countProductiveReads(input.brief.filesRead);
  if (!input.requireFloor) {
    return {
      ok: true,
      productiveReads,
      reasonCodes: ["discovery_quality_floor_waived"],
    };
  }

  const minReads = input.minProductiveReads ?? 2;
  const reasonCodes: string[] = [];
  let ok = true;

  if (productiveReads < minReads) {
    ok = false;
    reasonCodes.push("discovery_quality_insufficient_reads");
  }
  if (
    input.minSearches != null &&
    (input.searchCount ?? 0) < input.minSearches
  ) {
    ok = false;
    reasonCodes.push("discovery_quality_insufficient_searches");
  }
  if (
    input.brief.confidence === "low" &&
    input.brief.proposedChangeSurfaces.length === 0
  ) {
    ok = false;
    reasonCodes.push("discovery_quality_low_confidence_empty");
  }

  if (ok) reasonCodes.push("discovery_quality_floor_passed");
  return { ok, productiveReads, reasonCodes };
}
