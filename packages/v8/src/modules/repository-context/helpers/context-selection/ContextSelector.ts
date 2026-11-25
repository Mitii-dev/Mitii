import {
  CONTEXT_SELECTION_DEFAULTS,
  CONTEXT_SELECTION_IDS,
  CONTEXT_SELECTION_MESSAGES,
  CONTEXT_SELECTION_SCHEMA_VERSION,
} from "./constants";

import {
  ContextBudgetAllocator,
} from "./ContextBudgetAllocator";

import {
  ContextCandidatePreparer,
} from "./ContextCandidatePreparer";

import {
  ContextDiversityRanker,
} from "./ContextDiversityRanker";

import {
  ContextSelectionOptionsResolver,
} from "./ContextSelectionOptionsResolver";

import {
  ContextSelectionRequestNormalizer,
} from "./ContextSelectionRequestNormalizer";

import {
  ContextSelectionScorer,
} from "./ContextSelectionScorer";

import {
  ContextSelectionWarningAggregator,
} from "./ContextSelectionWarningAggregator";

import {
  budgetUsage,
  resolveStatus,
  statistics,
} from "./ContextSelectionResultMetrics";

import {
  contextSelectionResultSchema,
} from "./schema";

import type {
  ContextSelectionInput,
  ContextSelectionResult,
  ContextSelectionStatus,
  ContextSelectionWarning,
  ContextSelectorOptions,
  DroppedContextItem,
  NormalizedContextSelectionRequest,
  ResolvedContextSelectorOptions,
  SelectedContextItem,
} from "./types";

export class ContextSelector {
  public readonly id =
    CONTEXT_SELECTION_IDS
      .SELECTOR;

  private readonly options:
    ResolvedContextSelectorOptions;

  public constructor(
    options:
      ContextSelectorOptions = {},
    private readonly normalizer =
      new ContextSelectionRequestNormalizer(),
    private readonly preparer =
      new ContextCandidatePreparer(),
    private readonly scorer =
      new ContextSelectionScorer(),
    private readonly diversityRanker =
      new ContextDiversityRanker(),
    private readonly budgetAllocator =
      new ContextBudgetAllocator(),
    private readonly warningAggregator =
      new ContextSelectionWarningAggregator(),
    optionsResolver =
      new ContextSelectionOptionsResolver(),
  ) {
    this.options =
      optionsResolver.resolve(
        options,
      );
  }

  public select(
    input:
      ContextSelectionInput,
  ): ContextSelectionResult {
    const normalization =
      this.normalizer
        .normalize(input);
    const request =
      normalization.request;

    if (!request) {
      return this.empty(
        input.query,
        input.mode ??
          "agent",
        input.breadth ??
          "balanced",
        normalization
          .warnings,
      );
    }

    if (
      input.abortSignal
        ?.aborted ||
      request.retrieval
        .status ===
        "cancelled"
    ) {
      return this.cancelled(
        request,
        normalization
          .warnings,
      );
    }

    const warnings = [
      ...normalization
        .warnings,
    ];

    if (
      request.retrieval
        .status ===
        "partial"
    ) {
      warnings.push({
        code:
          "upstream_retrieval_partial",
        message:
          CONTEXT_SELECTION_MESSAGES
            .UPSTREAM_RETRIEVAL_PARTIAL,
      });
    }

    if (
      request.retrieval
        .status ===
        "failed"
    ) {
      warnings.push({
        code:
          "upstream_retrieval_failed",
        message:
          CONTEXT_SELECTION_MESSAGES
            .UPSTREAM_RETRIEVAL_FAILED,
      });
    }

    const preparation =
      this.preparer.prepare(
        request,
      );
    warnings.push(
      ...preparation
        .warnings,
    );

    const scored =
      preparation.candidates
        .map(
          (candidate) =>
            this.scorer.score({
              candidate,
              request,
            }),
        );

    const ranking =
      this.diversityRanker
        .rank({
          candidates:
            scored,
          mode:
            request.mode,
          breadth:
            request.breadth,
          ...(input.abortSignal
            ? {
                abortSignal:
                  input
                    .abortSignal,
              }
            : {}),
        });

    if (
      ranking.cancelled ||
      input.abortSignal
        ?.aborted
    ) {
      return this.cancelled(
        request,
        warnings,
        preparation
          .dropped,
        preparation
          .synthesizedReferences,
        preparation
          .candidates.length,
      );
    }

    const allocation =
      this.budgetAllocator
        .allocate({
          candidates:
            ranking
              .candidates,
          budget:
            request.budget,
          ...(input.abortSignal
            ? {
                abortSignal:
                  input
                    .abortSignal,
              }
            : {}),
        });

    warnings.push(
      ...allocation.warnings,
    );

    const dropped = [
      ...preparation
        .dropped,
      ...allocation.dropped,
    ];

    if (
      allocation.cancelled ||
      input.abortSignal
        ?.aborted
    ) {
      return this.cancelled(
        request,
        warnings,
        dropped,
        preparation
          .synthesizedReferences,
        preparation
          .candidates.length,
      );
    }

    if (
      allocation
        .requiredOmitted &&
      this.options
        .requiredOverflowMode ===
        "fail"
    ) {
      return this.build({
        request,
        status:
          "failed",
        items: [],
        dropped,
        warnings,
        synthesizedReferences:
          preparation
            .synthesizedReferences,
        consideredCandidates:
          preparation
            .candidates.length,
      });
    }

    const status =
      resolveStatus(
        request,
        allocation.items,
        dropped,
        warnings,
      );

    return this.build({
      request,
      status,
      items:
        allocation.items,
      dropped,
      warnings,
      synthesizedReferences:
        preparation
          .synthesizedReferences,
      consideredCandidates:
        preparation
          .candidates.length,
    });
  }

  private cancelled(
    request:
      NormalizedContextSelectionRequest,
    warnings:
      readonly ContextSelectionWarning[],
    dropped:
      readonly DroppedContextItem[] = [],
    synthesizedReferences = 0,
    consideredCandidates = 0,
  ): ContextSelectionResult {
    return this.build({
      request,
      status:
        "cancelled",
      items: [],
      dropped: [
        ...dropped,
      ],
      warnings: [
        ...warnings,
      ],
      synthesizedReferences,
      consideredCandidates,
    });
  }

  private empty(
    query: string,
    mode:
      ContextSelectionResult[
        "mode"
      ],
    breadth:
      ContextSelectionResult[
        "breadth"
      ],
    warnings:
      readonly ContextSelectionWarning[],
  ): ContextSelectionResult {
    const maximumTokens =
      CONTEXT_SELECTION_DEFAULTS
        .MAXIMUM_TOKENS;

    return this.validate({
      schemaVersion:
        CONTEXT_SELECTION_SCHEMA_VERSION,
      query,
      mode,
      breadth,
      status:
        "empty",
      items: [],
      dropped: [],
      warnings:
        this.warningAggregator
          .aggregate(
            warnings,
          ),
      budget: {
        maximumTokens,
        usedTokens:
          0,
        remainingTokens:
          maximumTokens,
        maximumItems:
          CONTEXT_SELECTION_DEFAULTS
            .MAXIMUM_ITEMS,
        maximumFiles:
          CONTEXT_SELECTION_DEFAULTS
            .MAXIMUM_FILES,
        maximumItemsPerFile:
          CONTEXT_SELECTION_DEFAULTS
            .MAXIMUM_ITEMS_PER_FILE,
      },
      statistics:
        statistics(
          [],
          [],
          0,
          0,
          0,
        ),
    });
  }

  private build(
    input: {
      request:
        NormalizedContextSelectionRequest;
      status:
        ContextSelectionStatus;
      items:
        SelectedContextItem[];
      dropped:
        DroppedContextItem[];
      warnings:
        readonly ContextSelectionWarning[];
      synthesizedReferences:
        number;
      consideredCandidates:
        number;
    },
  ): ContextSelectionResult {
    const items =
      input.status ===
        "failed" ||
      input.status ===
        "cancelled"
        ? []
        : input.items;
    const usedTokens =
      items.reduce(
        (sum, item) =>
          sum +
          item.allocatedTokens,
        0,
      );

    return this.validate({
      schemaVersion:
        CONTEXT_SELECTION_SCHEMA_VERSION,
      query:
        input.request.query,
      mode:
        input.request.mode,
      breadth:
        input.request
          .breadth,
      status:
        input.status,
      items,
      dropped:
        input.dropped,
      warnings:
        this.warningAggregator
          .aggregate(
            input.warnings,
          ),
      budget:
        budgetUsage(
          input.request
            .budget,
          usedTokens,
        ),
      statistics:
        statistics(
          items,
          input.dropped,
          input.request
            .retrieval
            .candidates
            .length,
          input
            .synthesizedReferences,
          input
            .consideredCandidates,
        ),
    });
  }

  private validate(
    result:
      ContextSelectionResult,
  ): ContextSelectionResult {
    return contextSelectionResultSchema
      .parse(result) as
      ContextSelectionResult;
  }
}
