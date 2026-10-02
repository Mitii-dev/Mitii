import {
  HYBRID_RETRIEVAL_DEFAULTS,
  HYBRID_RETRIEVAL_IDS,
  HYBRID_RETRIEVAL_MESSAGES,
  HYBRID_RETRIEVAL_SCHEMA_VERSION,
} from "./constants";

import {
  HybridRetrievalRequestNormalizer,
} from "./HybridRetrievalRequestNormalizer";

import {
  HybridRetrieverOptionsResolver,
} from "./HybridRetrieverOptionsResolver";

import {
  hybridRetrievalResultSchema,
  retrievalRerankerResultSchema,
  retrievalSourceResultSchema,
} from "./schema";

import {
  RetrievalSourceRegistry,
} from "./RetrievalSourceRegistry";

import {
  WeightedReciprocalRankFusion,
} from "./WeightedReciprocalRankFusion";

import {
  boostCandidatesByRepoMapImportance,
  importanceByPathFromRepoMapEntries,
} from "./boostByImportance";

import {
  applyModalityQuotas,
} from "./applyModalityQuotas";

import type {
  HybridRetrievalCandidate,
  HybridRetrievalInput,
  HybridRetrievalResult,
  HybridRetrievalSourceReport,
  HybridRetrievalStatistics,
  HybridRetrievalWarning,
  HybridRetrieverOptions,
  NormalizedHybridRetrievalRequest,
  ResolvedRetrievalSourceRegistration,
  ResolvedHybridRetrieverOptions,
  RetrievalReranker,
  RetrievalRerankerResult,
  RetrievalSourceResult,
  RetrievalSourceExecutionResult,
  RetrievalSourceRegistration,
  SuccessfulRetrievalSourceResult,
} from "./types";


class SoftSourceTimeoutError extends Error {
  constructor(
    readonly sourceId: string,
    readonly timeoutMs: number,
  ) {
    super(
      `${HYBRID_RETRIEVAL_MESSAGES.SOURCE_TIMEOUT} (${sourceId}, ${timeoutMs}ms)`,
    );
    this.name = "SoftSourceTimeoutError";
  }
}

export class HybridRetriever {
  private readonly options:
    ResolvedHybridRetrieverOptions;

  private readonly registry:
    RetrievalSourceRegistry;

  constructor(
    registrations:
      readonly RetrievalSourceRegistration[],
    options:
      HybridRetrieverOptions = {},
    private readonly reranker?:
      RetrievalReranker,
    private readonly normalizer =
      new HybridRetrievalRequestNormalizer(),
    private readonly fusion =
      new WeightedReciprocalRankFusion(),
    optionsResolver =
      new HybridRetrieverOptionsResolver(),
  ) {
    this.options =
      optionsResolver.resolve(
        options,
      );
    this.registry =
      new RetrievalSourceRegistry(
        registrations,
      );
  }

  public async retrieve(
    input: HybridRetrievalInput,
  ): Promise<HybridRetrievalResult> {
    const registrations =
      this.registry.list();

    if (
      input.abortSignal
        ?.aborted
    ) {
      return this.cancelled(
        input.query,
        registrations.map(
          (registration) =>
            this.report(
              registration.source.id,
              "cancelled",
              registration.required,
              registration.weight,
            ),
        ),
      );
    }

    const normalization =
      this.normalizer
        .normalize(
          input,
          this.options,
        );

    if (
      !normalization.request
    ) {
      return this.validate({
        schemaVersion:
          HYBRID_RETRIEVAL_SCHEMA_VERSION,
        query:
          input.query,
        status:
          "empty",
        candidates: [],
        sourceReports:
          registrations.map(
            (registration) =>
              this.report(
                registration.source.id,
                "skipped",
                registration.required,
                registration.weight,
              ),
          ),
        warnings:
          normalization.warnings,
        truncated:
          false,
        statistics:
          this.statistics(
            registrations.length,
            [],
            0,
            0,
            0,
          ),
      });
    }

    const request =
      normalization.request;
    const warnings = [
      ...normalization.warnings,
    ];

    const executions =
      await Promise.all(
        registrations.map(
          async (
            registration,
          ) => {
            try {
              if (
                !registration.source
                  .canRetrieve(
                    request,
                  )
              ) {
                return {
                  registration,
                  report:
                    this.report(
                      registration
                        .source.id,
                      "skipped",
                      registration
                        .required,
                      registration
                        .weight,
                    ),
                };
              }
            } catch (error) {
              return this.failedExecution(
                registration,
                error,
              );
            }

            return this.executeSource(
              registration,
              request,
              input.abortSignal,
            );
          },
        ),
      );

    if (
      input.abortSignal
        ?.aborted ||
      executions.some(
        (execution) =>
          execution.report
            .status ===
          "cancelled",
      )
    ) {
      return this.cancelled(
        request.query,
        executions.map(
          (execution) =>
            execution.report,
        ),
        warnings,
      );
    }

    this.collectSourceWarnings(
      executions,
      warnings,
    );

    if (
      !this.policySatisfied(
        executions,
      )
    ) {
      this.addPolicyWarning(
        executions,
        warnings,
      );

      return this.failed(
        request.query,
        executions,
        warnings,
      );
    }

    const successful =
      executions.flatMap(
        (
          execution,
        ): SuccessfulRetrievalSourceResult[] => {
          if (
            execution.report
              .status !==
              "complete" ||
            !execution.result
          ) {
            return [];
          }

          return [
            {
              sourceId:
                execution
                  .registration
                  .source.id,
              sourceWeight:
                execution
                  .registration
                  .weight,
              candidates:
                execution.result
                  .candidates,
              truncated:
                execution.result
                  .truncated,
            },
          ];
        },
      );

    const fusionLimit =
      this.reranker
        ? Math.max(
            request.maximumResults,
            this.options
              .rerankerCandidatePool,
          )
        : request.maximumResults;

    const {
      priorityCandidates,
      remainingSources,
    } = this.extractPriorityLane(
      request,
      successful,
    );

    const fusionResult =
      this.fusion.fuse({
        sourceResults:
          remainingSources,
        rankConstant:
          this.options
            .rankConstant,
        maximumResults:
          fusionLimit,
      });

    let candidates =
      this.mergePriorityLane(
        priorityCandidates,
        fusionResult.candidates,
        fusionLimit,
      );

      candidates =
      this.backfillFolderScopedMapCandidates(
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
    const hasSessionRanking = this.hasSessionRankingContext(
      request.rankingContext,
    );
    if (
      !hasSessionRanking &&
      request.repoMap?.entries?.length
    ) {
      const importanceByPath =
        importanceByPathFromRepoMapEntries(
          request.repoMap.entries,
        );
      const boosted =
        boostCandidatesByRepoMapImportance({
          candidates,
          importanceByPath,
        });
      candidates = boosted.candidates;
    }

    if (
      this.reranker &&
      candidates.length > 0
    ) {
      const reranked =
        await this.applyReranker(
          request.query,
          candidates,
          request.maximumResults,
          input.abortSignal,
          warnings,
        );

      if (!reranked) {
        return this.failed(
          request.query,
          executions,
          warnings,
          fusionResult,
        );
      }

      candidates =
        reranked;
    }

    candidates =
      this.backfillFolderScopedMapCandidates(
        request,
        successful,
        candidates,
      );

    const finalCandidates =
      candidates.slice(
        0,
        request.maximumResults,
      );

    const sourceTruncated =
      executions.some(
        (execution) =>
          execution.report
            .truncated,
      );
    const resultTruncated =
      fusionResult
        .uniqueCandidates >
      request.maximumResults;
    const truncated =
      sourceTruncated ||
      resultTruncated;

    if (
      resultTruncated
    ) {
      warnings.push({
        code:
          "result_limit_reached",
        message:
          HYBRID_RETRIEVAL_MESSAGES
            .RESULT_LIMIT_REACHED,
      });
    }

    const hasFailures =
      executions.some(
        (execution) =>
          execution.report
            .status ===
          "failed",
      );

    const status =
      finalCandidates.length ===
        0
        ? "empty"
        : hasFailures ||
            truncated ||
            warnings.length > 0
          ? "partial"
          : "complete";

    return this.validate({
      schemaVersion:
        HYBRID_RETRIEVAL_SCHEMA_VERSION,
      query:
        request.query,
      status,
      candidates:
        finalCandidates,
      sourceReports:
        executions.map(
          (execution) =>
            execution.report,
        ),
      warnings,
      truncated,
      statistics:
        this.statistics(
          registrations.length,
          executions,
          fusionResult
            .inputCandidates,
          fusionResult
            .uniqueCandidates,
          fusionResult
            .duplicateCandidatesRemoved,
          finalCandidates.length,
        ),
    });
  }

  private async executeSource(
    registration:
      ResolvedRetrievalSourceRegistration,
    request:
      NormalizedHybridRetrievalRequest,
    abortSignal:
      AbortSignal | undefined,
  ): Promise<RetrievalSourceExecutionResult> {
    const timeoutMs =
      registration.timeoutMs >= 0
        ? registration.timeoutMs
        : this.options.sourceTimeoutMs;

    try {
      const retrievePromise =
        registration.source.retrieve(
          request,
          {
            ...(abortSignal
              ? {
                  abortSignal,
                }
              : {}),
          },
        );

      const rawResult =
        timeoutMs > 0
          ? await this.withSoftTimeout(
              retrievePromise,
              timeoutMs,
              registration.source.id,
            )
          : await retrievePromise;

      const result =
        retrievalSourceResultSchema
          .parse(rawResult) as
          RetrievalSourceResult;

      const status =
        result.status ===
          "unavailable"
          ? "skipped"
          : result.status;

      return {
        registration,
        report:
          this.report(
            registration.source.id,
            status,
            registration.required,
            registration.weight,
            result.candidates
              .length,
            result.truncated,
            result.warnings
              .length,
          ),
        result,
      };
    } catch (error) {
      if (error instanceof SoftSourceTimeoutError) {
        return {
          registration,
          report: {
            ...this.report(
              registration.source.id,
              registration.required ? "failed" : "skipped",
              registration.required,
              registration.weight,
            ),
            error: error.message,
          },
          error,
        };
      }
      return this.failedExecution(
        registration,
        error,
      );
    }
  }

  private async withSoftTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    sourceId: string,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(
              new SoftSourceTimeoutError(
                sourceId,
                timeoutMs,
              ),
            );
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  private failedExecution(
    registration:
      ResolvedRetrievalSourceRegistration,
    error: unknown,
  ): RetrievalSourceExecutionResult {
    return {
      registration,
      report: {
        ...this.report(
          registration.source.id,
          "failed",
          registration.required,
          registration.weight,
        ),
        error:
          this.errorMessage(
            error,
          ),
      },
      error,
    };
  }

  private collectSourceWarnings(
    executions:
      readonly RetrievalSourceExecutionResult[],
    warnings:
      HybridRetrievalWarning[],
  ): void {
    for (
      const execution of
        executions
    ) {
      if (
        execution.report
          .status ===
        "failed"
      ) {
        const timedOut =
          execution.error instanceof
          SoftSourceTimeoutError;
        warnings.push({
          code:
            timedOut
              ? "source_timeout"
              : "source_failed",
          message:
            timedOut
              ? HYBRID_RETRIEVAL_MESSAGES
                  .SOURCE_TIMEOUT
              : HYBRID_RETRIEVAL_MESSAGES
                  .SOURCE_FAILED,
          sourceId:
            execution
              .registration
              .source.id,
        });
      }

      if (
        execution.report
          .status ===
          "skipped" &&
        execution.error instanceof
          SoftSourceTimeoutError
      ) {
        warnings.push({
          code:
            "source_timeout",
          message:
            HYBRID_RETRIEVAL_MESSAGES
              .SOURCE_TIMEOUT,
          sourceId:
            execution
              .registration
              .source.id,
        });
      }

      if (
        execution.registration
          .required &&
        execution.report
          .status ===
          "skipped"
      ) {
        warnings.push({
          code:
            "required_source_unavailable",
          message:
            HYBRID_RETRIEVAL_MESSAGES
              .REQUIRED_SOURCE_UNAVAILABLE,
          sourceId:
            execution
              .registration
              .source.id,
        });
      }

      if (
        execution.report
          .truncated
      ) {
        warnings.push({
          code:
            "source_truncated",
          message:
            HYBRID_RETRIEVAL_MESSAGES
              .SOURCE_TRUNCATED,
          sourceId:
            execution
              .registration
              .source.id,
        });
      }
    }
  }

  private policySatisfied(
    executions:
      readonly RetrievalSourceExecutionResult[],
  ): boolean {
    const successfulCount =
      executions.filter(
        (execution) =>
          execution.report
            .status ===
            "complete" ||
          execution.report
            .status ===
            "empty",
      ).length;

    if (
      successfulCount <
      this.options
        .minimumSuccessfulSources
    ) {
      return false;
    }

    if (
      this.options
        .failureMode ===
      "all_sources"
    ) {
      return executions.every(
        (execution) =>
          execution.report
            .status ===
            "complete" ||
          execution.report
            .status ===
            "empty",
      );
    }

    if (
      this.options
        .failureMode ===
      "required_sources"
    ) {
      return executions.every(
        (execution) =>
          !execution
            .registration
            .required ||
          execution.report
            .status ===
            "complete" ||
          execution.report
            .status ===
            "empty",
      );
    }

    return true;
  }

  private addPolicyWarning(
    executions:
      readonly RetrievalSourceExecutionResult[],
    warnings:
      HybridRetrievalWarning[],
  ): void {
    const successfulCount =
      executions.filter(
        (execution) =>
          execution.report
            .status ===
            "complete" ||
          execution.report
            .status ===
            "empty",
      ).length;

    if (
      successfulCount <
      this.options
        .minimumSuccessfulSources
    ) {
      warnings.push({
        code:
          "minimum_sources_unsatisfied",
        message:
          HYBRID_RETRIEVAL_MESSAGES
            .MINIMUM_SOURCES_UNSATISFIED,
      });

      return;
    }

    warnings.push({
      code:
        "failure_policy_unsatisfied",
      message:
        HYBRID_RETRIEVAL_MESSAGES
          .FAILURE_POLICY_UNSATISFIED,
    });
  }

  /**
   * Priority paths (required / explicit / current selection) form a lane that
   * is fused separately and prepended ahead of the main RRF result so weak
   * lexical hits cannot bury user anchors.
   */
  private hasSessionRankingContext(
    context:
      NormalizedHybridRetrievalRequest["rankingContext"],
  ): boolean {
    if (!context) {
      return false;
    }
    return Boolean(
      context.currentFile ||
        context.openFiles?.length ||
        context.gitDiffFiles?.length ||
        context.diagnosticFiles?.length ||
        context.recentEditFiles?.length ||
        context.staleFiles?.length ||
        context.priorityPaths?.length,
    );
  }

  private extractPriorityLane(
    request: NormalizedHybridRetrievalRequest,
    successful: readonly SuccessfulRetrievalSourceResult[],
  ): {
    priorityCandidates: HybridRetrievalCandidate[];
    remainingSources: SuccessfulRetrievalSourceResult[];
  } {
    const priorityPaths = new Set(
      (request.rankingContext?.priorityPaths ?? []).slice(
        0,
        HYBRID_RETRIEVAL_DEFAULTS.MAXIMUM_PRIORITY_PATHS,
      ),
    );

    if (priorityPaths.size === 0) {
      return {
        priorityCandidates: [],
        remainingSources: [...successful],
      };
    }

    const prioritySources: SuccessfulRetrievalSourceResult[] = [];
    const remainingSources: SuccessfulRetrievalSourceResult[] = [];

    for (const source of successful) {
      const priority: SuccessfulRetrievalSourceResult["candidates"][number][] =
        [];
      const remaining: SuccessfulRetrievalSourceResult["candidates"][number][] =
        [];
      for (const candidate of source.candidates) {
        if (priorityPaths.has(candidate.relativePath)) {
          priority.push(candidate);
        } else {
          remaining.push(candidate);
        }
      }
      if (priority.length > 0) {
        prioritySources.push({
          ...source,
          candidates: priority,
        });
      }
      remainingSources.push({
        ...source,
        candidates: remaining,
      });
    }

    if (prioritySources.length === 0) {
      return {
        priorityCandidates: [],
        remainingSources: [...successful],
      };
    }

    const priorityFusion = this.fusion.fuse({
      sourceResults: prioritySources,
      rankConstant: this.options.rankConstant,
      maximumResults: Math.max(
        priorityPaths.size,
        HYBRID_RETRIEVAL_DEFAULTS.MAXIMUM_PRIORITY_PATHS,
      ),
    });

    return {
      priorityCandidates: priorityFusion.candidates,
      remainingSources,
    };
  }

  private mergePriorityLane(
    priority: readonly HybridRetrievalCandidate[],
    fused: readonly HybridRetrievalCandidate[],
    maximumResults: number,
  ): HybridRetrievalCandidate[] {
    if (priority.length === 0) {
      return [...fused];
    }

    const seen = new Set<string>();
    const merged: HybridRetrievalCandidate[] = [];

    for (const candidate of priority) {
      if (seen.has(candidate.key)) {
        continue;
      }
      seen.add(candidate.key);
      merged.push(candidate);
      if (merged.length >= maximumResults) {
        return merged;
      }
    }

    for (const candidate of fused) {
      if (seen.has(candidate.key)) {
        continue;
      }
      seen.add(candidate.key);
      merged.push(candidate);
      if (merged.length >= maximumResults) {
        break;
      }
    }

    return merged;
  }

  /**
   * Folder-scoped queries must keep a catalog of in-folder map files even when
   * high-scoring out-of-folder lexical hits fill the fusion window. Count
   * in-folder paths, backfill from repo-map, then keep those ahead of junk.
   */
  private backfillFolderScopedMapCandidates(
    request: NormalizedHybridRetrievalRequest,
    successful: readonly SuccessfulRetrievalSourceResult[],
    candidates: HybridRetrievalCandidate[],
  ): HybridRetrievalCandidate[] {
    if (!request.folderPrefix) {
      return candidates;
    }

    const folderPrefix = request.folderPrefix;
    const floor = Math.min(
      HYBRID_RETRIEVAL_DEFAULTS.MINIMUM_FOLDER_SCOPED_RESULTS,
      request.maximumResults,
    );
    const inFolder: HybridRetrievalCandidate[] = [];
    const outOfFolder: HybridRetrievalCandidate[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (seen.has(candidate.relativePath)) {
        continue;
      }
      seen.add(candidate.relativePath);
      if (this.isUnderFolderPrefix(candidate.relativePath, folderPrefix)) {
        inFolder.push(candidate);
      } else {
        outOfFolder.push(candidate);
      }
    }
    if (inFolder.length >= floor) {
      return candidates;
    }

    const mapSource = successful.find(
      (source) => source.sourceId === HYBRID_RETRIEVAL_IDS.REPO_MAP_SOURCE,
    );
    if (!mapSource || mapSource.candidates.length === 0) {
      return candidates;
    }

    const extras = mapSource.candidates.filter(
      (candidate) =>
        !seen.has(candidate.relativePath) &&
        this.isUnderFolderPrefix(candidate.relativePath, folderPrefix),
    );
    if (extras.length === 0) {
      return candidates;
    }

    const fusedExtras = this.fusion.fuse({
      sourceResults: [
        {
          ...mapSource,
          candidates: extras,
        },
      ],
      rankConstant: this.options.rankConstant,
      maximumResults: Math.max(1, floor - inFolder.length),
    });

    return [...inFolder, ...fusedExtras.candidates, ...outOfFolder].slice(
      0,
      request.maximumResults,
    );
  }

  private isUnderFolderPrefix(
    relativePath: string,
    folderPrefix: string,
  ): boolean {
    return (
      relativePath === folderPrefix ||
      relativePath.startsWith(`${folderPrefix}/`)
    );
  }

  private async applyReranker(
    query: string,
    candidates:
      HybridRetrievalCandidate[],
    maximumResults: number,
    abortSignal:
      AbortSignal | undefined,
    warnings:
      HybridRetrievalWarning[],
  ): Promise<
    HybridRetrievalCandidate[] | null
  > {
    if (!this.reranker) {
      return candidates;
    }

    try {
      const pool =
        candidates.slice(
          0,
          this.options
            .rerankerCandidatePool,
        );

      const rawResult =
        await this.reranker
          .rerank({
            query,
            candidates:
              pool,
            maximumResults,
            ...(abortSignal
              ? {
                  abortSignal,
                }
              : {}),
          });

      const result =
        retrievalRerankerResultSchema
          .parse(rawResult) as
          RetrievalRerankerResult;

      const candidateKeys =
        new Set(
          pool.map(
            (candidate) =>
              candidate.key,
          ),
        );

      for (
        const rerankScore of
          result.scores
      ) {
        if (
          !candidateKeys.has(
            rerankScore.key,
          )
        ) {
          throw new Error(
            `Reranker returned unknown candidate key "${rerankScore.key}".`,
          );
        }
      }

      const scoreByKey =
        new Map(
          result.scores.map(
            (score) => [
              score.key,
              score,
            ],
          ),
        );

      if (
        scoreByKey.size <
        pool.length
      ) {
        warnings.push({
          code:
            "reranker_incomplete",
          message:
            HYBRID_RETRIEVAL_MESSAGES
              .RERANKER_INCOMPLETE,
        });
      }

      const reranked =
        candidates.map(
          (candidate) => {
            const rerankScore =
              scoreByKey.get(
                candidate.key,
              );

            if (!rerankScore) {
              return candidate;
            }

            return {
              ...candidate,
              rerankerScore:
                rerankScore.score,
              score:
                this.clamp(
                  candidate
                    .fusedScore *
                    (
                      1 -
                      this.options
                        .rerankerWeight
                    ) +
                    rerankScore
                      .score *
                      this.options
                        .rerankerWeight,
                ),
              reasons: [
                ...candidate.reasons,
                {
                  type:
                    "reranked" as const,
                  evidence:
                    rerankScore
                      .reason ??
                    `Reranked by ${this.reranker?.id ?? "reranker"}.`,
                },
              ],
            };
          },
        );

      this.sortCandidates(
        reranked,
      );

      return reranked;
    } catch (_error) {
      if (
        this.options
          .rerankerFailureMode ===
        "fail"
      ) {
        warnings.push({
          code:
            "reranker_failed",
          message:
            HYBRID_RETRIEVAL_MESSAGES
              .RERANKER_REQUIRED_FAILED,
        });

        return null;
      }

      warnings.push({
        code:
          "reranker_failed",
        message:
          HYBRID_RETRIEVAL_MESSAGES
            .RERANKER_FAILED,
      });

      return candidates;
    }
  }

  private failed(
    query: string,
    executions:
      readonly RetrievalSourceExecutionResult[],
    warnings:
      HybridRetrievalWarning[],
    fusion?: {
      inputCandidates: number;
      uniqueCandidates: number;
      duplicateCandidatesRemoved:
        number;
    },
  ): HybridRetrievalResult {
    return this.validate({
      schemaVersion:
        HYBRID_RETRIEVAL_SCHEMA_VERSION,
      query,
      status:
        "failed",
      candidates: [],
      sourceReports:
        executions.map(
          (execution) =>
            execution.report,
        ),
      warnings,
      truncated:
        false,
      statistics:
        this.statistics(
          executions.length,
          executions,
          fusion
            ?.inputCandidates ??
            0,
          fusion
            ?.uniqueCandidates ??
            0,
          fusion
            ?.duplicateCandidatesRemoved ??
            0,
        ),
    });
  }

  private cancelled(
    query: string,
    sourceReports:
      HybridRetrievalSourceReport[],
    warnings:
      HybridRetrievalWarning[] = [],
  ): HybridRetrievalResult {
    return this.validate({
      schemaVersion:
        HYBRID_RETRIEVAL_SCHEMA_VERSION,
      query,
      status:
        "cancelled",
      candidates: [],
      sourceReports,
      warnings,
      truncated:
        false,
      statistics:
        this.statisticsFromReports(
          sourceReports.length,
          sourceReports,
          0,
          0,
          0,
        ),
    });
  }

  private report(
    sourceId: string,
    status:
      HybridRetrievalSourceReport[
        "status"
      ],
    required: boolean,
    weight: number,
    candidateCount = 0,
    truncated = false,
    warningCount = 0,
  ): HybridRetrievalSourceReport {
    return {
      sourceId,
      status,
      required,
      weight,
      candidateCount,
      truncated,
      warningCount,
    };
  }

  private statistics(
    configuredSources: number,
    executions:
      readonly RetrievalSourceExecutionResult[],
    sourceCandidates: number,
    uniqueCandidates: number,
    duplicateCandidatesRemoved:
      number,
    returnedCandidates = 0,
  ): HybridRetrievalStatistics {
    return this.statisticsFromReports(
      configuredSources,
      executions.map(
        (execution) =>
          execution.report,
      ),
      sourceCandidates,
      uniqueCandidates,
      duplicateCandidatesRemoved,
      returnedCandidates,
    );
  }

  private statisticsFromReports(
    configuredSources: number,
    reports:
      readonly HybridRetrievalSourceReport[],
    sourceCandidates: number,
    uniqueCandidates: number,
    duplicateCandidatesRemoved:
      number,
    returnedCandidates = 0,
  ): HybridRetrievalStatistics {
    return {
      configuredSources,
      attemptedSources:
        reports.filter(
          (report) =>
            report.status !==
            "skipped",
        ).length,
      successfulSources:
        reports.filter(
          (report) =>
            report.status ===
              "complete" ||
            report.status ===
              "empty",
        ).length,
      failedSources:
        reports.filter(
          (report) =>
            report.status ===
              "failed" ||
            report.status ===
              "cancelled",
        ).length,
      skippedSources:
        reports.filter(
          (report) =>
            report.status ===
            "skipped",
        ).length,
      sourceCandidates,
      uniqueCandidates,
      duplicateCandidatesRemoved,
      returnedCandidates,
    };
  }

  private sortCandidates(
    candidates:
      HybridRetrievalCandidate[],
  ): void {
    candidates.sort(
      (left, right) =>
        right.score -
          left.score ||
        right.matchedSourceCount -
          left.matchedSourceCount ||
        left.key.localeCompare(
          right.key,
        ),
    );
  }

  private clamp(
    value: number,
  ): number {
    return Math.max(
      0,
      Math.min(1, value),
    );
  }

  private errorMessage(
    error: unknown,
  ): string {
    return error instanceof Error
      ? error.message
      : String(error);
  }

  private validate(
    result:
      HybridRetrievalResult,
  ): HybridRetrievalResult {
    return hybridRetrievalResultSchema
      .parse(result) as
      HybridRetrievalResult;
  }
}
