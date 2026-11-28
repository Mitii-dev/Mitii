import {
  HYBRID_RETRIEVAL_MESSAGES,
  HYBRID_RETRIEVAL_SCHEMA_VERSION,
} from "./constants";
import { HybridRetrievalRequestNormalizer } from "./HybridRetrievalRequestNormalizer";
import { HybridRetrieverOptionsResolver } from "./HybridRetrieverOptionsResolver";
import { RetrievalSourceRegistry } from "./RetrievalSourceRegistry";
import { WeightedReciprocalRankFusion } from "./WeightedReciprocalRankFusion";
import { applyHybridReranker } from "./applyHybridReranker";
import { applyModalityQuotas } from "./applyModalityQuotas";
import {
  boostCandidatesByRepoMapImportance,
  importanceByPathFromRepoMapEntries,
} from "./boostByImportance";
import {
  executeRetrievalSource,
  failedExecution,
} from "./executeRetrievalSource";
import { backfillFolderScopedMapCandidates } from "./folderScopedMapBackfill";
import {
  buildCancelledResult,
  buildFailedResult,
  buildSourceReport,
  buildStatistics,
  validateHybridResult,
} from "./hybridRetrievalResultBuilders";
import {
  addPolicyWarning,
  collectSourceWarnings,
  policySatisfied,
} from "./hybridSourcePolicy";
import {
  extractPriorityLane,
  hasSessionRankingContext,
  mergePriorityLane,
} from "./priorityLaneFusion";

import type {
  HybridRetrievalInput,
  HybridRetrievalResult,
  HybridRetrieverOptions,
  ResolvedHybridRetrieverOptions,
  RetrievalReranker,
  RetrievalSourceExecutionResult,
  RetrievalSourceRegistration,
  SuccessfulRetrievalSourceResult,
} from "./types";

export class HybridRetriever {
  private readonly options: ResolvedHybridRetrieverOptions;

  private readonly registry: RetrievalSourceRegistry;

  constructor(
    registrations: readonly RetrievalSourceRegistration[],
    options: HybridRetrieverOptions = {},
    private readonly reranker?: RetrievalReranker,
    private readonly normalizer = new HybridRetrievalRequestNormalizer(),
    private readonly fusion = new WeightedReciprocalRankFusion(),
    optionsResolver = new HybridRetrieverOptionsResolver(),
  ) {
    this.options = optionsResolver.resolve(options);
    this.registry = new RetrievalSourceRegistry(registrations);
  }

  public async retrieve(
    input: HybridRetrievalInput,
  ): Promise<HybridRetrievalResult> {
    const registrations = this.registry.list();

    if (input.abortSignal?.aborted) {
      return buildCancelledResult(
        input.query,
        registrations.map((registration) =>
          buildSourceReport(
            registration.source.id,
            "cancelled",
            registration.required,
            registration.weight,
          ),
        ),
      );
    }

    const normalization = this.normalizer.normalize(input, this.options);

    if (!normalization.request) {
      return validateHybridResult({
        schemaVersion: HYBRID_RETRIEVAL_SCHEMA_VERSION,
        query: input.query,
        status: "empty",
        candidates: [],
        sourceReports: registrations.map((registration) =>
          buildSourceReport(
            registration.source.id,
            "skipped",
            registration.required,
            registration.weight,
          ),
        ),
        warnings: normalization.warnings,
        truncated: false,
        statistics: buildStatistics(registrations.length, [], 0, 0, 0),
      });
    }

    const request = normalization.request;
    const warnings = [...normalization.warnings];

    const executions: RetrievalSourceExecutionResult[] = await Promise.all(
      registrations.map(async (registration) => {
        try {
          if (!registration.source.canRetrieve(request)) {
            return {
              registration,
              report: buildSourceReport(
                registration.source.id,
                "skipped",
                registration.required,
                registration.weight,
              ),
            };
          }
        } catch (error) {
          return failedExecution(registration, error);
        }

        return executeRetrievalSource(
          registration,
          request,
          input.abortSignal,
          this.options.sourceTimeoutMs,
        );
      }),
    );

    if (
      input.abortSignal?.aborted ||
      executions.some((execution) => execution.report.status === "cancelled")
    ) {
      return buildCancelledResult(
        request.query,
        executions.map((execution) => execution.report),
        warnings,
      );
    }

    collectSourceWarnings(executions, warnings);

    if (!policySatisfied(executions, this.options)) {
      addPolicyWarning(executions, warnings, this.options);
      return buildFailedResult(request.query, executions, warnings);
    }

    const successful = executions.flatMap(
      (execution): SuccessfulRetrievalSourceResult[] => {
        if (execution.report.status !== "complete" || !execution.result) {
          return [];
        }

        return [
          {
            sourceId: execution.registration.source.id,
            sourceWeight: execution.registration.weight,
            candidates: execution.result.candidates,
            truncated: execution.result.truncated,
          },
        ];
      },
    );

    const fusionLimit = this.reranker
      ? Math.max(request.maximumResults, this.options.rerankerCandidatePool)
      : request.maximumResults;

    const { priorityCandidates, remainingSources } = extractPriorityLane(
      this.fusion,
      this.options,
      request,
      successful,
    );

    const fusionResult = this.fusion.fuse({
      sourceResults: remainingSources,
      rankConstant: this.options.rankConstant,
      maximumResults: fusionLimit,
    });

    let candidates = mergePriorityLane(
      priorityCandidates,
      fusionResult.candidates,
      fusionLimit,
    );

    candidates = backfillFolderScopedMapCandidates(
      this.fusion,
      this.options,
      request,
      successful,
      candidates,
    );

    const quotaResult = applyModalityQuotas({
      candidates,
      successful,
      maximumResults: fusionLimit,
    });
    candidates = quotaResult.candidates;
    if (quotaResult.warning) {
      warnings.push(quotaResult.warning);
    }

    // Optional post-RRF boost from published RepoMap composite scores.
    // Skip when session rankingContext is present — query-time map re-rank
    // already applied personalization; published index-time scores would
    // otherwise pull stale files back to the top.
    if (
      !hasSessionRankingContext(request.rankingContext) &&
      request.repoMap?.entries?.length
    ) {
      const importanceByPath = importanceByPathFromRepoMapEntries(
        request.repoMap.entries,
      );
      candidates = boostCandidatesByRepoMapImportance({
        candidates,
        importanceByPath,
      }).candidates;
    }

    if (this.reranker && candidates.length > 0) {
      const reranked = await applyHybridReranker(
        this.reranker,
        this.options,
        request.query,
        candidates,
        request.maximumResults,
        input.abortSignal,
        warnings,
      );

      if (!reranked) {
        return buildFailedResult(
          request.query,
          executions,
          warnings,
          fusionResult,
        );
      }

      candidates = reranked;
    }

    candidates = backfillFolderScopedMapCandidates(
      this.fusion,
      this.options,
      request,
      successful,
      candidates,
    );

    const finalCandidates = candidates.slice(0, request.maximumResults);

    const sourceTruncated = executions.some(
      (execution) => execution.report.truncated,
    );
    const resultTruncated =
      fusionResult.uniqueCandidates > request.maximumResults;
    const truncated = sourceTruncated || resultTruncated;

    if (resultTruncated) {
      warnings.push({
        code: "result_limit_reached",
        message: HYBRID_RETRIEVAL_MESSAGES.RESULT_LIMIT_REACHED,
      });
    }

    const hasFailures = executions.some(
      (execution) => execution.report.status === "failed",
    );

    const status =
      finalCandidates.length === 0
        ? "empty"
        : hasFailures || truncated || warnings.length > 0
          ? "partial"
          : "complete";

    return validateHybridResult({
      schemaVersion: HYBRID_RETRIEVAL_SCHEMA_VERSION,
      query: request.query,
      status,
      candidates: finalCandidates,
      sourceReports: executions.map((execution) => execution.report),
      warnings,
      truncated,
      statistics: buildStatistics(
        registrations.length,
        executions,
        fusionResult.inputCandidates,
        fusionResult.uniqueCandidates,
        fusionResult.duplicateCandidatesRemoved,
        finalCandidates.length,
      ),
    });
  }
}
