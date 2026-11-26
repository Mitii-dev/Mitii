/**
 * Assemble system/user messages for a pin-discovery model loop.
 */
import type { ModelMessage } from "../../../modules/model-gateway";
import type { WindowPolicy } from "../../../modules/window-budget";

import type { ShapedDiscoveryProfile } from "../actions/shapedDiscovery";
import {
  buildDiscoveryPrompt,
  formatDiscoveryPreReadEvidence,
  type createDiscoveryObservationCollector,
} from "../internal/discovery";

export function buildPinDiscoveryPassMessages(params: {
  query: string;
  objective: string;
  uniqueSeeds: string[];
  shapedSeeds: string[];
  rankedPreferred: string[];
  shapedProfile: ShapedDiscoveryProfile | undefined;
  discoveryScopeHint: string | undefined;
  preReadByPath: Map<string, string>;
  perFileChars: number;
  windowPolicy: WindowPolicy;
  seeds: string[];
  qualityFloor: boolean;
  preferSymbolEvidence: boolean;
  collector: ReturnType<typeof createDiscoveryObservationCollector>;
  qualityFloorNudge: string;
}): ModelMessage[] {
  const {
    query,
    objective,
    uniqueSeeds,
    shapedSeeds,
    rankedPreferred,
    shapedProfile,
    discoveryScopeHint,
    preReadByPath,
    perFileChars,
    windowPolicy,
    seeds,
    qualityFloor,
    preferSymbolEvidence,
    collector,
    qualityFloorNudge,
  } = params;

  const promptSeeds =
    uniqueSeeds.length > 0
      ? uniqueSeeds
      : [...shapedSeeds, ...rankedPreferred].slice(0, 6);
  const shapedHint = shapedProfile?.discoverySystemHint;
  const scopeHint = discoveryScopeHint?.trim();
  const mergedSystemHint =
    shapedHint && scopeHint
      ? `${shapedHint} ${scopeHint}`
      : shapedHint ?? scopeHint;
  const prompt = buildDiscoveryPrompt({
    query,
    objective,
    preferredPaths: promptSeeds,
    shapedDiscovery: {
      preferredPathsLabel: shapedProfile?.preferredPathsLabel,
      ...(mergedSystemHint
        ? { discoverySystemHint: mergedSystemHint }
        : {}),
    },
  });
  const preReadEvidence = formatDiscoveryPreReadEvidence(
    [...preReadByPath.entries()].map(([path, content]) => ({ path, content })),
    {
      maxCharsPerFile: perFileChars,
      maxTotalChars: Math.min(
        16_000,
        windowPolicy.compaction.toolResultContentChars * 4,
      ),
    },
  );
  const preReadPaths = [...preReadByPath.keys()];
  const userParts = [prompt.user];
  if (preReadEvidence.length > 0) {
    userParts.push(
      preReadEvidence,
      `Contents above were already read for: ${preReadPaths.join(", ")}. Do not call read_file again for those paths unless nextStartLine/uncovered lines are needed. Prefer read_file({ path, startLine: nextStartLine }) for remainder. Continue only if more surfaces are needed.`,
    );
    if (preferSymbolEvidence) {
      userParts.push(
        "Entrypoints above are already read — call document_symbol or goto_definition on them next to name key types/functions.",
      );
    }
  } else if (seeds.length > 0) {
    userParts.push(
      `Already pre-read: ${seeds.join(", ")}. Continue only if more surfaces are needed.`,
    );
  }
  if (qualityFloor && collector.fileReads === 0) {
    userParts.push(qualityFloorNudge);
  }
  return [
    { role: "system", content: prompt.system },
    { role: "user", content: userParts.join("\n\n") },
  ];
}
