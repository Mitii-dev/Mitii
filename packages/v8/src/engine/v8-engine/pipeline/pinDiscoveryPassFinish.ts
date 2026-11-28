/**
 * Compile discovery brief, emit completion, and apply quality-floor failure.
 */
import { compileDiscoveryBrief } from "../../../modules/planning";
import type {
  DiscoveryBrief,
  DiscoveryTarget,
  PlanningInput,
} from "../../../modules/planning";

import { isPlanDiscoveryEvidenceSufficient } from "../modules/plan-discovery";
import type { AgentReasonCode } from "../contracts";
import {
  createDiscoveryObservationCollector,
  toDiscoveryObservation,
} from "../internal/discovery";
import type { EventBus } from "../internal/EventBus";
import type { AgentEngineRuntime } from "./runtime";
import { buildDiscoveryFailureWarning } from "./pinDiscoveryPassNudges";
import type { DiscoveryPassStopReason } from "./pinDiscoveryPassLoop";

export function finishDiscoveryPass(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  bus: EventBus;
  objective: string;
  evidence: PlanningInput["evidence"];
  collector: ReturnType<typeof createDiscoveryObservationCollector>;
  explicitTargets: DiscoveryTarget[];
  qualityFloor: boolean;
  thoroughEvidence: boolean;
  requireSymbolEvidence: boolean;
  minSearches: number;
  stopReason: DiscoveryPassStopReason;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
}): { brief: DiscoveryBrief; failed: boolean } {
  const {
    runtime,
    runId,
    bus,
    objective,
    evidence,
    collector,
    explicitTargets,
    qualityFloor,
    thoroughEvidence,
    requireSymbolEvidence,
    minSearches,
    stopReason,
    reasonCodes,
    warnings,
  } = params;

  const brief = compileDiscoveryBrief(
    toDiscoveryObservation({
      objective,
      collector,
      explicitTargets,
      constraints: evidence.constraints ?? [],
    }),
  );
  const failed = qualityFloor
    ? !isPlanDiscoveryEvidenceSufficient(brief, {
        thorough: thoroughEvidence,
        requireSymbolEvidence,
        minSearches,
        searchCount: collector.searches,
      })
    : brief.confidence === "low" && brief.proposedChangeSurfaces.length === 0;
  reasonCodes.push(failed ? "discovery_failed" : "discovery_completed");
  runtime.emit(bus, {
    type: "discovery_completed",
    runId,
    confidence: brief.confidence,
    fileCount: brief.filesRead.length,
    surfaceCount: brief.proposedChangeSurfaces.length,
    openQuestionCount: brief.openQuestions.length,
    brief,
    stopReason,
    qualityFloorMet: !failed,
    at: runtime.isoNow(),
  });
  runtime.emitStage(bus, runId, "discovery", "completed", [
    failed ? "discovery_failed" : "discovery_completed",
  ]);
  if (failed) {
    warnings.push(
      buildDiscoveryFailureWarning({ qualityFloor, thoroughEvidence }),
    );
  }
  return { brief, failed };
}
