import {
  applyChangeImpactCouplingCycles,
  assessChangeImpactGraph,
  buildEmptyChangeImpactResult,
  finalizeChangeImpactResult,
  resolveChangeImpactSeeds,
  walkChangeImpact,
} from "./steps";
import {
  CHANGE_IMPACT_MESSAGES,
  CHANGE_IMPACT_REASON,
  CHANGE_IMPACT_STAGES,
} from "../constants";
import {
  ChangeImpactError,
  changeImpactInputSchema,
  noopModuleLogger,
} from "../types";
import type {
  ChangeImpactParsedInput,
  ChangeImpactReasonCode,
  ChangeImpactResult,
  ModuleLoggerPort,
} from "../types";

export type ChangeImpactPipelineDependencies = {
  log?: ModuleLoggerPort;
};

/**
 * Answers blast-radius questions over a published RepoGraph.
 *
 * Flow (analyze):
 *   1-assess-graph → 2-resolve-seeds → 3-walk-impact
 *   → 4-apply-coupling-cycles → 5-finalize-result
 *
 * Edges are recorded dependent → dependency. `dependents` walks them in
 * reverse; `dependencies` walks them forward.
 *
 * Multi-seed / plan-check live in actions 6–9.
 */
export class ChangeImpactPipeline {
  private readonly log: ModuleLoggerPort;

  constructor(dependencies: ChangeImpactPipelineDependencies = {}) {
    this.log = dependencies.log ?? noopModuleLogger;
  }

  public analyze(input: ChangeImpactParsedInput | unknown): ChangeImpactResult {
    let parsed: ChangeImpactParsedInput;
    try {
      parsed = changeImpactInputSchema.parse(input);
    } catch (error) {
      throw new ChangeImpactError(
        "invalid_input",
        CHANGE_IMPACT_MESSAGES.analyzeInputInvalid,
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const reasonCodes = new Set<ChangeImpactReasonCode>();

    let stageStartedMs = Date.now();
    const assessed = assessChangeImpactGraph({ input: parsed });
    for (const code of assessed.reasonCodes) {
      reasonCodes.add(code);
    }
    const warnings = [...assessed.warnings];
    this.log.stage({
      module: "change-impact",
      stage: CHANGE_IMPACT_STAGES.assessGraph,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: assessed.reasonCodes,
      outputSummary: {
        confidence: assessed.confidence.confidence,
        unsafe: assessed.confidence.unsafe,
        graphStatus: parsed.repoGraph.status,
      },
    });

    stageStartedMs = Date.now();
    const seeds = resolveChangeImpactSeeds({
      input: parsed,
      warnings,
      reasonCodes,
    });
    this.log.stage({
      module: "change-impact",
      stage: CHANGE_IMPACT_STAGES.resolveSeeds,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [],
      outputSummary: { resolvedCount: seeds.resolvedSeeds.length },
    });

    if (seeds.resolvedSeeds.length === 0) {
      reasonCodes.add(CHANGE_IMPACT_REASON.seedUnresolved);
      return buildEmptyChangeImpactResult({
        input: parsed,
        confidence: assessed.confidence,
        warnings,
        reasonCodes,
        seedRelativePath: seeds.seedRelativePath,
      });
    }

    stageStartedMs = Date.now();
    const walk = walkChangeImpact({
      input: parsed,
      resolvedSeeds: seeds.resolvedSeeds,
      nodeById: seeds.nodeById,
      fileByFileId: seeds.fileByFileId,
      warnings,
    });
    for (const code of walk.reasonCodes) {
      reasonCodes.add(code);
    }
    this.log.stage({
      module: "change-impact",
      stage: CHANGE_IMPACT_STAGES.walkImpact,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: walk.reasonCodes,
      outputSummary: {
        affectedNodes: walk.affected.length,
        affectedFiles: walk.affectedFiles.length,
        truncated: walk.truncated,
      },
    });

    stageStartedMs = Date.now();
    const coupled = applyChangeImpactCouplingCycles({
      graph: parsed.repoGraph,
      seedRelativePath: seeds.seedRelativePath,
      resolvedSeeds: seeds.resolvedSeeds,
      affectedFiles: walk.affectedFiles,
      structuralNeighborPaths: walk.structuralNeighborPaths,
      coupling: parsed.historicalCoupling ?? [],
      edgeTypes: parsed.edgeTypes,
      includePackages: parsed.includePackages,
      nodeById: seeds.nodeById,
      fileByFileId: seeds.fileByFileId,
    });
    for (const code of coupled.reasonCodes) {
      reasonCodes.add(code);
    }
    warnings.push(...coupled.warnings);
    this.log.stage({
      module: "change-impact",
      stage: CHANGE_IMPACT_STAGES.applyCouplingCycles,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: coupled.reasonCodes,
      outputSummary: {
        cycles: coupled.cycles.length,
        hiddenCoupling: coupled.hiddenCoupling.length,
      },
    });

    stageStartedMs = Date.now();
    const result = finalizeChangeImpactResult({
      input: parsed,
      confidence: assessed.confidence,
      seedRelativePath: seeds.seedRelativePath,
      resolvedSeeds: seeds.resolvedSeeds,
      affected: walk.affected,
      affectedFiles: coupled.affectedFiles,
      packagesAffected: walk.packagesAffected,
      chains: walk.chains,
      cycles: coupled.cycles,
      hiddenCoupling: coupled.hiddenCoupling,
      directNeighborCounts: walk.directNeighborCounts,
      neighborhood: walk.neighborhood,
      truncated: walk.truncated,
      warnings,
      reasonCodes,
    });
    this.log.stage({
      module: "change-impact",
      stage: CHANGE_IMPACT_STAGES.finalizeResult,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: result.reasonCodes,
      outputSummary: {
        status: result.status,
        blastLevel: result.blastRadius.level,
        riskTier: result.blastRadius.riskTier,
      },
    });

    return result;
  }
}
