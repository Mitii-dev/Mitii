import type {
  DiscoveryBrief,
  DiscoveryChangeSurface,
  PlanStep,
} from "../contracts";
import { DEFAULT_MAX_STEPS_PER_PHASE } from "../defaults";
import { clipPhrase, step } from "./draftPlanShared";

export function buildDiscoveryChangeSteps(
  discoveryBrief: DiscoveryBrief | undefined,
  risk: PlanStep["riskLevel"],
): PlanStep[] {
  const surfaces = discoveryBrief?.proposedChangeSurfaces ?? [];
  if (surfaces.length === 0) {
    return [];
  }
  return surfaces.slice(0, DEFAULT_MAX_STEPS_PER_PHASE).map((surface, index) =>
    discoverySurfaceStep(surface, index, risk),
  );
}

export function discoverySurfaceStep(
  surface: DiscoveryChangeSurface,
  index: number,
  risk: PlanStep["riskLevel"],
): PlanStep {
  return step(
    `step-change-surface-${index + 1}`,
    clipPhrase(`${surface.actionHint} ${surface.path}`, 200),
    [surface.path],
    clipPhrase(surface.evidence, 1_000),
    `The requested change on ${surface.path} is applied without unrelated edits.`,
    surface.riskLevel === "low" ? risk : surface.riskLevel,
  );
}
