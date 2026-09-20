import type { DiscoveryBrief } from "../../../modules/planning";
import type { AgentMode } from "../../../modules/request-intake";

export type PlanningDepthForQuality = "none" | "internal" | "visible";

/**
 * When true, discovery must produce file-backed evidence before a concrete
 * plan is treated as ready.
 *
 * - Plan mode (except thoroughness Low / `quick`): always.
 * - Agent mode: only for big tasks already assigned a plan depth
 *   (`visible` / wide `internal`) — same foolproof bar as Plan, then execute.
 */
export function requiresPlanDiscoveryQualityFloor(params: {
  mode: AgentMode;
  explorationDepth?: "auto" | "quick" | "deep";
  planningDepth?: PlanningDepthForQuality;
  /** Wide Agent scopes (package+/complex+/recommendsPlanning). */
  agentWideScope?: boolean;
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
  if (params.planningDepth === "visible") {
    return true;
  }
  if (params.planningDepth === "internal" && params.agentWideScope === true) {
    return true;
  }
  return false;
}

/**
 * Plan-mode thoroughness (user expects a foolproof one-shot plan): align with
 * DiscoveryBrief high confidence — ≥2 productive reads and ≥2 change surfaces.
 * Agent big-task floor keeps the base medium bar unless `thorough` is set.
 */
export function isPlanDiscoveryEvidenceSufficient(
  brief: Pick<
    DiscoveryBrief,
    "filesRead" | "proposedChangeSurfaces" | "confidence"
  >,
  options?: { thorough?: boolean; requireSymbolEvidence?: boolean },
): boolean {
  if (options?.thorough) {
    return isThoroughPlanDiscoveryEvidenceSufficient(brief, {
      requireSymbolEvidence: options.requireSymbolEvidence === true,
    });
  }
  return (
    brief.filesRead.length >= 1 &&
    brief.proposedChangeSurfaces.length > 0 &&
    brief.confidence !== "low"
  );
}

/**
 * Foolproof Plan / Agent-visible discovery: multi-file, multi-surface,
 * non-low confidence (matches CompileDiscoveryBrief high band intent).
 * When `requireSymbolEvidence` is set (host code navigation usable), at least
 * one read file must carry attached symbols from code-intelligence tools.
 */
export function isThoroughPlanDiscoveryEvidenceSufficient(
  brief: Pick<
    DiscoveryBrief,
    "filesRead" | "proposedChangeSurfaces" | "confidence"
  >,
  options?: { requireSymbolEvidence?: boolean },
): boolean {
  if (brief.confidence === "low") {
    return false;
  }
  if (
    brief.filesRead.length < 2 ||
    brief.proposedChangeSurfaces.length < 1
  ) {
    return false;
  }
  if (options?.requireSymbolEvidence === true) {
    return brief.filesRead.some(
      (file) => Array.isArray(file.symbols) && file.symbols.length > 0,
    );
  }
  return true;
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
 * True whenever nav tools are granted, even if forced tool choice is unavailable.
 */
export function shouldPreferDiscoverySymbolEvidence(params: {
  thorough: boolean;
  allowedTools: readonly string[];
  reasonCodes: readonly string[];
  codeIntelligenceToolIds: readonly string[];
}): boolean {
  if (!params.thorough) {
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
