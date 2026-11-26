/**
 * File-backed discovery quality floor (S3A-DISCOVER) — runtime-owned thin bar.
 * Planning module still owns full validators; this decides clarify vs continue.
 */

import type { DiscoveryBrief } from "../../../modules/planning";

const NOISE =
  /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|\.mitii\/)/i;
const MANIFEST = /(?:^|\/)(?:package\.json|tsconfig[\w.-]*\.json)$/i;

export function isProductiveDiscoveryPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return !NOISE.test(normalized) && !MANIFEST.test(normalized);
}

export function countProductiveReads(
  filesRead: readonly { path: string }[],
): number {
  const seen = new Set<string>();
  for (const file of filesRead) {
    if (!isProductiveDiscoveryPath(file.path)) continue;
    seen.add(file.path.replace(/\\/g, "/").toLowerCase());
  }
  return seen.size;
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
