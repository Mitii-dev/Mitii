import type { DiscoveryBrief } from "../../../../modules/planning";
import type { AgentMode } from "../../../../modules/request-intake";

export type PlanningDepthForQuality = "none" | "internal" | "visible";
export type PlanningTaskSizeForQuality = "small" | "medium" | "large";

const TEST_LIKE = /(?:\.test|\.spec|\/tests?\/|\/__tests__\/)/i;
/** Lockfiles / tooling noise — never count as productive discovery reads. */
const NOISE_CONFIG =
  /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|composer\.lock|Cargo\.lock|\.mitii\/)/i;
/** Package/tsconfig manifests — padding only, not productive source reads. */
const MANIFEST_CONFIG =
  /(?:^|\/)(?:package\.json|tsconfig[\w.-]*\.json)$/i;

export type PlanDiscoverySufficiencyOptions = {
  thorough?: boolean;
  requireSymbolEvidence?: boolean;
  /** When set, discovery must have performed at least this many searches. */
  minSearches?: number;
  /** Actual search/glob tool uses from the discovery collector. */
  searchCount?: number;
};

/**
 * When true, discovery must produce file-backed evidence before a concrete
 * plan is treated as ready.
 *
 * - Plan mode (except thoroughness Low / `quick`): always.
 * - Agent mode: medium/large taskSize, or big tasks already assigned a plan
 *   depth (`visible` / wide `internal`) — same foolproof bar as Plan, then execute.
 */
export function requiresPlanDiscoveryQualityFloor(params: {
  mode: AgentMode;
  explorationDepth?: "auto" | "quick" | "deep";
  planningDepth?: PlanningDepthForQuality;
  /** Wide Agent scopes (package+/complex+/recommendsPlanning). */
  agentWideScope?: boolean;
  /** Officer taskSize — medium/large require file-backed discovery. */
  taskSize?: PlanningTaskSizeForQuality;
}): boolean {
  if (params.explorationDepth === "quick") {
    return false;
  }
  if (params.mode === "plan") {
    return true;
  }
  if (params.mode !== "agent") {
    return false;
  }
  if (params.taskSize === "medium" || params.taskSize === "large") {
    return true;
  }
  if (params.planningDepth === "visible") {
    return true;
  }
  if (params.planningDepth === "internal" && params.agentWideScope === true) {
    return true;
  }
  return false;
}

/**
 * Source/config reads that count toward the thorough Plan floor.
 * Excludes lockfiles and package/tsconfig manifests so entry+package.json
 * cannot fake multi-file discovery.
 */
export function isProductiveDiscoveryReadPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  if (NOISE_CONFIG.test(normalized) || MANIFEST_CONFIG.test(normalized)) {
    return false;
  }
  return true;
}

export function countProductiveDiscoveryReads(
  filesRead: readonly { path: string }[],
): number {
  const seen = new Set<string>();
  for (const file of filesRead) {
    if (!isProductiveDiscoveryReadPath(file.path)) {
      continue;
    }
    seen.add(file.path.replace(/\\/g, "/").toLowerCase());
  }
  return seen.size;
}

/**
 * Plan-mode thoroughness (user expects a foolproof one-shot plan): productive
 * multi-file evidence, multi-surface or surface+related, non-low confidence.
 * Agent big-task floor keeps the base medium bar unless `thorough` is set.
 */
export function isPlanDiscoveryEvidenceSufficient(
  brief: Pick<
    DiscoveryBrief,
    "filesRead" | "proposedChangeSurfaces" | "confidence"
  >,
  options?: PlanDiscoverySufficiencyOptions,
): boolean {
  if (options?.thorough) {
    return isThoroughPlanDiscoveryEvidenceSufficient(brief, options);
  }
  return (
    brief.filesRead.length >= 1 &&
    brief.proposedChangeSurfaces.length > 0 &&
    brief.confidence !== "low"
  );
}

/**
 * Foolproof Plan / Agent-visible discovery:
 * - ≥2 productive reads (not lockfile/manifest padding)
 * - ≥2 change surfaces, or ≥1 surface plus a related test / non-surface read
 * - non-low confidence
 * - optional symbol attachment and min search count
 */
export function isThoroughPlanDiscoveryEvidenceSufficient(
  brief: Pick<
    DiscoveryBrief,
    "filesRead" | "proposedChangeSurfaces" | "confidence"
  >,
  options?: PlanDiscoverySufficiencyOptions,
): boolean {
  if (brief.confidence === "low") {
    return false;
  }
  const productiveReads = countProductiveDiscoveryReads(brief.filesRead);
  if (productiveReads < 2) {
    return false;
  }
  const surfaces = brief.proposedChangeSurfaces;
  if (surfaces.length < 1) {
    return false;
  }
  if (surfaces.length < 2 && !hasRelatedDiscoverySupport(brief)) {
    return false;
  }
  if (options?.requireSymbolEvidence === true) {
    const hasSymbols = brief.filesRead.some(
      (file) => Array.isArray(file.symbols) && file.symbols.length > 0,
    );
    if (!hasSymbols) {
      return false;
    }
  }
  const minSearches = options?.minSearches ?? 0;
  if (minSearches > 0 && (options?.searchCount ?? 0) < minSearches) {
    return false;
  }
  return true;
}

/** Related test file, or a productive read that is not itself a change surface. */
function hasRelatedDiscoverySupport(
  brief: Pick<DiscoveryBrief, "filesRead" | "proposedChangeSurfaces">,
): boolean {
  const surfacePaths = new Set(
    brief.proposedChangeSurfaces.map((surface) =>
      surface.path.replace(/\\/g, "/").toLowerCase(),
    ),
  );
  for (const file of brief.filesRead) {
    const path = file.path.replace(/\\/g, "/");
    if (TEST_LIKE.test(path)) {
      return true;
    }
    if (
      isProductiveDiscoveryReadPath(path) &&
      !surfacePaths.has(path.toLowerCase())
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Single decision helper so discovery failure and Engine clarify cannot drift.
 * Callers that already ran discovery SHOULD pass `discoveryFailed` from the
 * pass result rather than recomputing with weaker options.
 */
export function shouldClarifyAfterPlanDiscovery(params: {
  qualityFloor: boolean;
  discoveryFailed: boolean;
}): boolean {
  return params.qualityFloor && params.discoveryFailed;
}

/** True when Plan (or Agent-visible) should use the thorough evidence bar. */
export function usesThoroughPlanDiscoveryEvidence(params: {
  mode: AgentMode;
  planningDepth?: PlanningDepthForQuality;
}): boolean {
  if (params.mode === "plan") {
    return true;
  }
  return params.mode === "agent" && params.planningDepth === "visible";
}

/**
 * Thorough Plan / Agent-visible discovery must perform at least one search/glob.
 * Seed reads alone cannot satisfy the floor (avoids hollow one-shot plans).
 */
export function resolvePlanDiscoveryMinSearches(params: {
  thorough: boolean;
  taskSize?: PlanningTaskSizeForQuality | string;
}): number {
  void params.taskSize;
  if (!params.thorough) {
    return 0;
  }
  return 1;
}

/**
 * Whether thorough discovery should require symbol attachment from
 * code-intelligence tools (when those tools are granted and not unavailable).
 * When the host cannot force tool_choice=required, callers should nudge but
 * not hard-fail the quality floor on missing symbols.
 */
export function shouldRequireDiscoverySymbolEvidence(params: {
  thorough: boolean;
  allowedTools: readonly string[];
  reasonCodes: readonly string[];
  codeIntelligenceToolIds: readonly string[];
  /** When false, return false so discovery soft-nudge instead of hard-fail. */
  supportsForcedToolChoice?: boolean;
}): boolean {
  if (!params.thorough) {
    return false;
  }
  if (params.supportsForcedToolChoice === false) {
    return false;
  }
  if (params.reasonCodes.includes("code_navigation_unavailable")) {
    return false;
  }
  return params.codeIntelligenceToolIds.some((id) =>
    params.allowedTools.includes(id),
  );
}

/**
 * Soft preference for symbol tools during discovery (nudges only).
 * True for thorough Plan / Agent-visible OR medium/large bounded discovery.
 */
export function shouldPreferDiscoverySymbolEvidence(params: {
  thorough: boolean;
  allowedTools: readonly string[];
  reasonCodes: readonly string[];
  codeIntelligenceToolIds: readonly string[];
  /** Soft symbol nudge for medium/large without thorough bar. */
  preferSymbols?: boolean;
}): boolean {
  if (!params.thorough && params.preferSymbols !== true) {
    return false;
  }
  if (params.reasonCodes.includes("code_navigation_unavailable")) {
    return false;
  }
  return params.codeIntelligenceToolIds.some((id) =>
    params.allowedTools.includes(id),
  );
}

export function clarifyAfterInsufficientPlanDiscovery(
  priorConfidence?: number,
  options?: { thorough?: boolean },
): {
  schemaVersion: 1;
  strategy: "clarify";
  rationale: string;
  skipDiscover: true;
  useBuildEvidence: false;
  confidence: number;
} {
  return {
    schemaVersion: 1,
    strategy: "clarify",
    rationale: options?.thorough
      ? "Plan requires multi-file, multi-surface discovery before a concrete plan; evidence was insufficient."
      : "Plan mode requires file-backed discovery before a concrete plan; evidence was insufficient.",
    skipDiscover: true,
    useBuildEvidence: false,
    confidence: priorConfidence ?? 0.4,
  };
}
