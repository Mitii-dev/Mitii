import {
  CHANGE_IMPACT_SCHEMA_VERSION,
} from "../constants";
import {
  ChangeImpactError,
  changeImpactInputSchema,
  changeImpactResultSchema,
} from "../contracts";
import type {
  ChangeImpactParsedInput,
  ChangeImpactReasonCode,
  ChangeImpactResult,
  ChangeImpactWarningCode,
} from "../contracts";
import { applyHistoricalCoupling } from "../internal/applyHistoricalCoupling";
import {
  affectedHasTestDependent,
  classifyBlastRadius,
} from "../internal/classifyBlastRadius";
import { computeGraphConfidence } from "../internal/computeGraphConfidence";
import { countSeedNeighborhood } from "../internal/countSeedNeighborhood";
import { detectSeedCycles } from "../internal/detectSeedCycles";
import {
  createFileIndex,
  createNodeIndex,
  createProjectIndex,
  normalizeRelativePath,
} from "../internal/impactGraphHelpers";
import {
  aggregateAffectedFiles,
  countDirectNeighbors,
  runImpactWalk,
  toAffectedNodes,
  toAffectedPackages,
  toChains,
} from "../internal/runImpactWalk";
import { resolveEffectiveEdgeTypes } from "../internal/resolveEffectiveEdgeTypes";
import { resolveSeedNodes } from "../internal/resolveSeedNodes";
import { CHANGE_IMPACT_POLICY } from "../policy";

/**
 * Answers blast-radius questions over a published RepoGraph.
 * Edges are recorded dependent → dependency. `dependents` walks them in
 * reverse (who points at the seed). `dependencies` walks them forward
 * (what the seed imports / depends on).
 *
 * Multi-seed / plan-check live in actions (`analyzeManyChangeImpact`,
 * `planCheckChangeImpact`) to avoid coupling the single-seed facade to merge
 * orchestration.
 */
export class ChangeImpactPipeline {
  public analyze(input: ChangeImpactParsedInput | unknown): ChangeImpactResult {
    let parsed: ChangeImpactParsedInput;
    try {
      parsed = changeImpactInputSchema.parse(input);
    } catch (error) {
      throw new ChangeImpactError(
        "invalid_input",
        "Change impact input failed schema validation.",
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const graph = parsed.repoGraph;
    const nodeById = createNodeIndex(graph);
    const fileByFileId = createFileIndex(graph);
    const projectByProjectId = createProjectIndex(graph);
    const warnings: Array<{
      code: ChangeImpactWarningCode;
      message: string;
    }> = [];
    const reasonCodes = new Set<ChangeImpactReasonCode>();

    const confidenceAssessment = computeGraphConfidence(graph);
    if (graph.status === "partial") {
      warnings.push({
        code: "graph_partial",
        message:
          "Repository graph was built partially; impact may be incomplete.",
      });
    }
    if (confidenceAssessment.unsafe) {
      reasonCodes.add("graph_confidence_unsafe");
      warnings.push({
        code: "graph_confidence_unsafe",
        message:
          confidenceAssessment.note ??
          "Graph confidence is below the unsafe threshold; widen verification.",
      });
    } else if (confidenceAssessment.low) {
      warnings.push({
        code: "graph_confidence_low",
        message:
          confidenceAssessment.note ??
          "Graph confidence is below the preferred threshold.",
      });
    }

    if (
      parsed.codeIndexChangeToken &&
      parsed.codeIndexChangeToken !== graph.codeIndexChangeToken
    ) {
      reasonCodes.add("graph_stale");
    }

    const resolvedSeeds = resolveSeedNodes({
      input: parsed,
      nodeById,
      fileByFileId,
      projectByProjectId,
      warnings,
      reasonCodes,
    });

    const seedRelativePath = seedPathFromInput(parsed);
    const emptyBlast = classifyBlastRadius({
      seedRelativePath,
      affectedFileCount: 0,
      hop1FileCount: 0,
      seedOutFileCount: 0,
      seedInFileCount: 0,
      hasTestDependent: false,
      confidence: confidenceAssessment.confidence,
      graphConfidenceUnsafe: confidenceAssessment.unsafe,
    });

    if (resolvedSeeds.length === 0) {
      reasonCodes.add("seed_unresolved");
      return changeImpactResultSchema.parse({
        schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
        status: resolveStatus({
          truncated: false,
          reasonCodes,
          graphPartial: graph.status === "partial",
          graphConfidenceUnsafe: confidenceAssessment.unsafe,
          hasImpact: false,
        }),
        direction: parsed.direction,
        seed: parsed.seed,
        resolvedSeeds: [],
        affected: [],
        affectedFiles: [],
        packagesAffected: [],
        chains: [],
        cycles: [],
        hiddenCoupling: [],
        directNeighborCounts: { nodes: 0, files: 0 },
        totals: {
          affectedNodes: 0,
          affectedFiles: 0,
          packages: 0,
          chains: 0,
        },
        confidence: confidenceAssessment.confidence,
        ...(confidenceAssessment.note
          ? { confidenceNote: confidenceAssessment.note }
          : {}),
        graphConfidenceUnsafe: confidenceAssessment.unsafe,
        blastRadius: emptyBlast,
        truncated: false,
        warnings,
        reasonCodes: [...reasonCodes],
        graphRevision: graph.workspaceSnapshotId,
        codeIndexChangeToken: graph.codeIndexChangeToken,
      });
    }

    const edgeTypes = resolveEffectiveEdgeTypes({
      edgeTypes: parsed.edgeTypes,
      includePackages: parsed.includePackages,
    });

    const walk = runImpactWalk({
      graph,
      seedNodeIds: resolvedSeeds.map((seed) => seed.node.id),
      edgeTypes,
      maximumHops: parsed.maximumHops,
      maximumAffectedNodes: parsed.maximumAffectedNodes,
      maximumPaths: parsed.maximumPaths,
      nodeById,
      fileByFileId,
      importanceByRelativePath: parsed.importanceByRelativePath,
      reverse: parsed.direction !== "dependencies",
    });
    for (const code of walk.reasonCodes) {
      reasonCodes.add(code);
    }

    const affected = toAffectedNodes({
      visits: walk.visits,
      nodeById,
      fileByFileId,
      warnings,
    });
    let affectedFiles = aggregateAffectedFiles(affected);
    const packagesAffected = parsed.includePackages
      ? toAffectedPackages({
          visits: walk.visits,
          nodeById,
          maximumPackages: CHANGE_IMPACT_POLICY.maximumPackages,
        })
      : [];
    const chains = toChains({
      rawChains: walk.chains,
      nodeById,
      fileByFileId,
    });
    const directNeighborCounts = countDirectNeighbors({
      visits: walk.visits,
      nodeById,
      fileByFileId,
    });
    const neighborhood = countSeedNeighborhood({
      graph,
      seedNodeIds: resolvedSeeds.map((seed) => seed.node.id),
      edgeTypes,
      nodeById,
      fileByFileId,
    });

    const structuralNeighborPaths = new Set(
      affectedFiles.map((file) => normalizeRelativePath(file.relativePath)),
    );
    const coupling = applyHistoricalCoupling({
      seedRelativePath,
      affectedFiles,
      coupling: parsed.historicalCoupling ?? [],
      structuralNeighborPaths,
    });
    affectedFiles = coupling.affectedFiles;
    for (const code of coupling.reasonCodes) reasonCodes.add(code);
    warnings.push(...coupling.warnings);

    const cycles = detectSeedCycles({
      graph,
      seedNodeIds: resolvedSeeds.map((seed) => seed.node.id),
      edgeTypes,
      nodeById,
      fileByFileId,
    });
    if (cycles.length > 0) {
      reasonCodes.add("seed_cycle_detected");
      warnings.push({
        code: "seed_cycle_detected",
        message: `Detected ${cycles.length} cycle(s) involving the seed neighborhood.`,
      });
    }

    if (
      affected.length > 0 ||
      packagesAffected.length > 0 ||
      coupling.hiddenCoupling.length > 0
    ) {
      reasonCodes.add("impact_resolved");
    } else {
      reasonCodes.add(
        parsed.direction === "dependencies"
          ? "no_dependencies"
          : "no_dependents",
      );
    }

    const blastRadius = classifyBlastRadius({
      seedRelativePath,
      affectedFileCount: affectedFiles.length,
      hop1FileCount: directNeighborCounts.files,
      seedOutFileCount: neighborhood.outFiles,
      seedInFileCount: neighborhood.inFiles,
      hasTestDependent: affectedHasTestDependent(affectedFiles),
      confidence: confidenceAssessment.confidence,
      graphConfidenceUnsafe: confidenceAssessment.unsafe,
      cycleCount: cycles.length,
      hiddenCouplingCount: coupling.hiddenCoupling.length,
    });

    return changeImpactResultSchema.parse({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      status: resolveStatus({
        truncated: walk.truncated,
        reasonCodes,
        graphPartial: graph.status === "partial",
        graphConfidenceUnsafe: confidenceAssessment.unsafe,
        hasImpact:
          affected.length > 0 ||
          packagesAffected.length > 0 ||
          coupling.hiddenCoupling.length > 0,
      }),
      direction: parsed.direction,
      seed: parsed.seed,
      resolvedSeeds: resolvedSeeds.map(({ node, file }) => ({
        nodeId: node.id,
        kind: node.kind,
        ...(file ? { relativePath: file.relativePath } : {}),
        ...(node.kind === "file" ? { relativePath: node.relativePath } : {}),
        ...(node.kind === "symbol"
          ? {
              symbolName: node.name,
              symbolKind: node.symbolKind,
              ...(typeof node.startLine === "number"
                ? { startLine: node.startLine }
                : {}),
            }
          : {}),
      })),
      affected,
      affectedFiles,
      packagesAffected,
      chains,
      cycles,
      hiddenCoupling: coupling.hiddenCoupling,
      directNeighborCounts,
      totals: {
        affectedNodes: affected.length,
        affectedFiles: affectedFiles.length,
        packages: packagesAffected.length,
        chains: chains.length,
      },
      confidence: confidenceAssessment.confidence,
      ...(confidenceAssessment.note
        ? { confidenceNote: confidenceAssessment.note }
        : {}),
      graphConfidenceUnsafe: confidenceAssessment.unsafe,
      blastRadius,
      truncated: walk.truncated,
      warnings,
      reasonCodes: [...reasonCodes],
      graphRevision: graph.workspaceSnapshotId,
      codeIndexChangeToken: graph.codeIndexChangeToken,
    });
  }
}

function resolveStatus(params: {
  truncated: boolean;
  reasonCodes: ReadonlySet<ChangeImpactReasonCode>;
  graphPartial: boolean;
  graphConfidenceUnsafe: boolean;
  hasImpact: boolean;
}): ChangeImpactResult["status"] {
  if (
    params.truncated ||
    params.reasonCodes.has("graph_stale") ||
    params.graphPartial ||
    params.graphConfidenceUnsafe
  ) {
    return "partial";
  }
  return params.hasImpact ? "ok" : "empty";
}

function seedPathFromInput(
  parsed: ChangeImpactParsedInput,
): string | undefined {
  if (
    parsed.seed.kind === "file" ||
    parsed.seed.kind === "symbol" ||
    parsed.seed.kind === "caret"
  ) {
    return normalizeRelativePath(parsed.seed.relativePath);
  }
  return undefined;
}
