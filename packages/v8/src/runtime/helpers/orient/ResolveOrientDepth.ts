/**
 * S1-GATE — light orient always; heavy retrieve only when budgeted.
 */

export type OrientDepth = "light" | "heavy";

export interface ResolveOrientDepthInput {
  mode?: "ask" | "plan" | "agent";
  /** Window band from assertWindowBand / windowPolicy. */
  windowBand?: "compact" | "standard" | "wide" | string;
  contextWindowTokens?: number;
  /** Host kill-switch for heavy retrieve. */
  forceLight?: boolean;
  /** Host asks for deep gather. */
  forceHeavy?: boolean;
  route?: string;
  /** When true, force heavy even in ask (repo context required). */
  repositoryContextRequired?: boolean;
}

export interface ResolveOrientDepthResult {
  depth: OrientDepth;
  /** Caps passed to retrieveEnrichMaterials. */
  maxSkills: number;
  maxMemory: number;
  maxRepo: number;
  reasonCodes: string[];
}

/**
 * Compact / ask → light; plan/agent + standard/wide → heavy with rising caps.
 */
export function resolveOrientDepth(
  input: ResolveOrientDepthInput,
): ResolveOrientDepthResult {
  if (input.forceLight) {
    return {
      depth: "light",
      maxSkills: 4,
      maxMemory: 4,
      maxRepo: 6,
      reasonCodes: ["orient_depth_forced_light"],
    };
  }
  if (input.forceHeavy) {
    return {
      depth: "heavy",
      maxSkills: 16,
      maxMemory: 24,
      maxRepo: 24,
      reasonCodes: ["orient_depth_forced_heavy"],
    };
  }

  // Ask repository / diagnose paths need enrich ports (event-bus parity).
  if (
    input.route === "repository_answer" ||
    input.route === "diagnose" ||
    input.repositoryContextRequired === true
  ) {
    return {
      depth: "heavy",
      maxSkills: 8,
      maxMemory: 8,
      maxRepo: 16,
      reasonCodes: [
        "orient_depth_heavy",
        "orient_repo_required",
        ...(input.route ? [`orient_route_${input.route}`] : []),
      ],
    };
  }

  const band =
    input.windowBand ??
    (input.contextWindowTokens != null
      ? input.contextWindowTokens < 50_000
        ? "compact"
        : input.contextWindowTokens < 120_000
          ? "standard"
          : "wide"
      : "standard");

  if (band === "compact" || input.mode === "ask") {
    return {
      depth: "light",
      maxSkills: 6,
      maxMemory: 6,
      maxRepo: 8,
      reasonCodes: [
        "orient_depth_light",
        `orient_band_${band}`,
        ...(input.mode === "ask" ? ["orient_light_ask_mode"] : []),
      ],
    };
  }

  if (band === "wide") {
    return {
      depth: "heavy",
      maxSkills: 20,
      maxMemory: 32,
      maxRepo: 32,
      reasonCodes: ["orient_depth_heavy", "orient_band_wide"],
    };
  }

  // standard — heavy for plan/agent, light caps for others
  if (input.mode === "plan" || input.mode === "agent") {
    return {
      depth: "heavy",
      maxSkills: 12,
      maxMemory: 16,
      maxRepo: 16,
      reasonCodes: ["orient_depth_heavy", "orient_band_standard"],
    };
  }

  return {
    depth: "light",
    maxSkills: 8,
    maxMemory: 8,
    maxRepo: 10,
    reasonCodes: ["orient_depth_light", "orient_band_standard"],
  };
}
