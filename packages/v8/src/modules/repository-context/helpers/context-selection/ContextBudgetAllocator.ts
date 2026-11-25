import {
  CONTEXT_SELECTION_DEFAULTS,
  CONTEXT_SELECTION_IDS,
  CONTEXT_SELECTION_MESSAGES,
} from "./constants";

import type {
  ContextBudgetAllocationInput,
  ContextBudgetAllocationResult,
  ContextRepresentationOption,
  ContextSelectionDropCause,
  ContextSelectionWarning,
  DroppedContextItem,
  ScoredContextCandidate,
  SelectedContextItem,
} from "./types";

export class ContextBudgetAllocator {
  public readonly id =
    CONTEXT_SELECTION_IDS
      .BUDGET_ALLOCATOR;

  public allocate(
    input:
      ContextBudgetAllocationInput,
  ): ContextBudgetAllocationResult {
    const items:
      SelectedContextItem[] = [];
    const dropped:
      DroppedContextItem[] = [];
    const selectedFiles =
      new Set<string>();
    const perFileCount =
      new Map<string, number>();
    const fullFileKeys =
      new Set<string>();
    let usedTokens =
      0;
    let requiredOmitted =
      false;
    let downgradedCount =
      0;
    let unknownEstimateCount =
      0;
    const causeCounts =
      new Map<
        ContextSelectionDropCause,
        number
      >();

    for (
      const scored of
        input.candidates
    ) {
      if (
        input.abortSignal
          ?.aborted
      ) {
        return {
          items,
          dropped,
          warnings:
            this.warnings(
              causeCounts,
              downgradedCount,
              unknownEstimateCount,
            ),
          usedTokens,
          cancelled:
            true,
          requiredOmitted,
        };
      }

      const candidate =
        scored.candidate;
      const fileKey =
        this.fileKey(
          candidate.rootId,
          candidate
            .relativePath,
        );
      const primaryEstimate =
        scored
          .representationOptions[0]
          ?.estimatedTokens ??
        0;

      if (
        scored.score <
          input.budget
            .minimumScore &&
        candidate.priority !==
          "required" &&
        items.length >=
          input.budget
            .minimumItems
      ) {
        this.drop(
          dropped,
          causeCounts,
          scored,
          "low_score",
          primaryEstimate,
          "The candidate score was below the configured minimum.",
        );
        continue;
      }

      if (
        fullFileKeys.has(
          fileKey,
        ) &&
        candidate.priority !==
          "required"
      ) {
        this.drop(
          dropped,
          causeCounts,
          scored,
          "covered_by_full_file",
          primaryEstimate,
          "A selected full-file representation already covers this candidate.",
        );
        continue;
      }

      if (
        items.length >=
        input.budget
          .maximumItems
      ) {
        this.dropForLimit(
          dropped,
          causeCounts,
          scored,
          "item_limit",
          primaryEstimate,
          "The context item limit was reached.",
        );
        requiredOmitted =
          requiredOmitted ||
          candidate.priority ===
            "required";
        continue;
      }

      const isNewFile =
        !selectedFiles.has(
          fileKey,
        );

      if (
        isNewFile &&
        selectedFiles.size >=
          input.budget
            .maximumFiles
      ) {
        this.dropForLimit(
          dropped,
          causeCounts,
          scored,
          "file_limit",
          primaryEstimate,
          "The context file limit was reached.",
        );
        requiredOmitted =
          requiredOmitted ||
          candidate.priority ===
            "required";
        continue;
      }

      const fileCount =
        perFileCount.get(
          fileKey,
        ) ??
        0;

      if (
        fileCount >=
        input.budget
          .maximumItemsPerFile
      ) {
        this.dropForLimit(
          dropped,
          causeCounts,
          scored,
          "per_file_limit",
          primaryEstimate,
          "The per-file context item limit was reached.",
        );
        requiredOmitted =
          requiredOmitted ||
          candidate.priority ===
            "required";
        continue;
      }

      const remainingTokens =
        input.budget
          .maximumTokens -
        usedTokens;
      const selectedOption =
        this.selectOption(
          scored,
          remainingTokens,
        );

      if (!selectedOption) {
        this.dropForLimit(
          dropped,
          causeCounts,
          scored,
          "token_budget",
          primaryEstimate,
          "No candidate representation fit the remaining token budget.",
        );
        requiredOmitted =
          requiredOmitted ||
          candidate.priority ===
            "required";
        continue;
      }

      const optionIndex =
        scored
          .representationOptions
          .findIndex(
            (option) =>
              option
                .representation ===
                selectedOption
                  .representation,
          );

      if (
        optionIndex > 0
      ) {
        downgradedCount +=
          1;
      }

      if (
        scored
          .usedDefaultEstimate
      ) {
        unknownEstimateCount +=
          1;
      }

      usedTokens +=
        selectedOption
          .estimatedTokens;
      selectedFiles.add(
        fileKey,
      );
      perFileCount.set(
        fileKey,
        fileCount + 1,
      );

      if (
        selectedOption
          .representation ===
        "full_file"
      ) {
        fullFileKeys.add(
          fileKey,
        );
      }

      items.push({
        key:
          candidate.key,
        origin: [
          ...candidate.origins,
        ],
        priority:
          candidate.priority,
        entityKind:
          candidate.entityKind,
        ...(candidate.rootId
          ? {
              rootId:
                candidate.rootId,
            }
          : {}),
        relativePath:
          candidate
            .relativePath,
        ...(candidate.chunkId
          ? {
              chunkId:
                candidate.chunkId,
            }
          : {}),
        ...(candidate.symbolId
          ? {
              symbolId:
                candidate.symbolId,
            }
          : {}),
        ...(candidate.startLine !==
        undefined
          ? {
              startLine:
                candidate.startLine,
            }
          : {}),
        ...(candidate.endLine !==
        undefined
          ? {
              endLine:
                candidate.endLine,
            }
          : {}),
        ...(candidate
          .retrievalCandidate
          ? {
              retrievalCandidate:
                candidate
                  .retrievalCandidate,
            }
          : {}),
        representation:
          selectedOption
            .representation,
        allocatedTokens:
          selectedOption
            .estimatedTokens,
        estimatedTokens:
          primaryEstimate ||
          selectedOption
            .estimatedTokens,
        score:
          scored.score,
        selectionOrder:
          items.length + 1,
        signals:
          scored.signals.map(
            (signal) => ({
              ...signal,
            }),
          ),
      });
    }

    return {
      items,
      dropped,
      warnings:
        this.warnings(
          causeCounts,
          downgradedCount,
          unknownEstimateCount,
        ),
      usedTokens,
      cancelled:
        false,
      requiredOmitted,
    };
  }

  private selectOption(
    candidate:
      ScoredContextCandidate,
    remainingTokens: number,
  ): ContextRepresentationOption |
    undefined {
    return candidate
      .representationOptions
      .find(
        (option) =>
          option
            .estimatedTokens <=
            remainingTokens &&
          option
            .estimatedTokens >=
            CONTEXT_SELECTION_DEFAULTS
              .MINIMUM_REPRESENTATION_TOKENS,
      );
  }

  private dropForLimit(
    dropped:
      DroppedContextItem[],
    counts:
      Map<
        ContextSelectionDropCause,
        number
      >,
    candidate:
      ScoredContextCandidate,
    cause:
      | "token_budget"
      | "item_limit"
      | "file_limit"
      | "per_file_limit",
    estimatedTokens: number,
    evidence: string,
  ): void {
    const effectiveCause =
      candidate.candidate
        .priority ===
        "required"
        ? "required_reference_omitted"
        : cause;

    this.drop(
      dropped,
      counts,
      candidate,
      effectiveCause,
      estimatedTokens,
      evidence,
    );

    if (
      effectiveCause !==
      cause
    ) {
      counts.set(
        cause,
        (
          counts.get(
            cause,
          ) ??
          0
        ) +
          1,
      );
    }
  }

  private drop(
    dropped:
      DroppedContextItem[],
    counts:
      Map<
        ContextSelectionDropCause,
        number
      >,
    candidate:
      ScoredContextCandidate,
    cause:
      ContextSelectionDropCause,
    estimatedTokens: number,
    evidence: string,
  ): void {
    dropped.push({
      key:
        candidate
          .candidate.key,
      relativePath:
        candidate
          .candidate
          .relativePath,
      cause,
      priority:
        candidate
          .candidate
          .priority,
      score:
        candidate.score,
      estimatedTokens,
      evidence,
    });

    counts.set(
      cause,
      (
        counts.get(
          cause,
        ) ??
        0
      ) +
        1,
    );
  }

  private warnings(
    counts:
      ReadonlyMap<
        ContextSelectionDropCause,
        number
      >,
    downgradedCount: number,
    unknownEstimateCount: number,
  ): ContextSelectionWarning[] {
    const warnings:
      ContextSelectionWarning[] = [];

    this.pushWarning(
      warnings,
      counts.get(
        "token_budget",
      ),
      "token_budget_reached",
      CONTEXT_SELECTION_MESSAGES
        .TOKEN_BUDGET_REACHED,
    );
    this.pushWarning(
      warnings,
      counts.get(
        "item_limit",
      ),
      "item_limit_reached",
      CONTEXT_SELECTION_MESSAGES
        .ITEM_LIMIT_REACHED,
    );
    this.pushWarning(
      warnings,
      counts.get(
        "file_limit",
      ),
      "file_limit_reached",
      CONTEXT_SELECTION_MESSAGES
        .FILE_LIMIT_REACHED,
    );
    this.pushWarning(
      warnings,
      counts.get(
        "per_file_limit",
      ),
      "per_file_limit_reached",
      CONTEXT_SELECTION_MESSAGES
        .PER_FILE_LIMIT_REACHED,
    );
    this.pushWarning(
      warnings,
      counts.get(
        "required_reference_omitted",
      ),
      "required_reference_omitted",
      CONTEXT_SELECTION_MESSAGES
        .REQUIRED_REFERENCE_OMITTED,
    );
    this.pushWarning(
      warnings,
      downgradedCount,
      "representation_downgraded",
      CONTEXT_SELECTION_MESSAGES
        .REPRESENTATION_DOWNGRADED,
    );
    this.pushWarning(
      warnings,
      unknownEstimateCount,
      "unknown_token_estimate",
      CONTEXT_SELECTION_MESSAGES
        .UNKNOWN_TOKEN_ESTIMATE,
    );

    return warnings;
  }

  private pushWarning(
    warnings:
      ContextSelectionWarning[],
    count:
      number |
      undefined,
    code:
      ContextSelectionWarning[
        "code"
      ],
    message: string,
  ): void {
    if (
      !count ||
      count <= 0
    ) {
      return;
    }

    warnings.push({
      code,
      message,
      count,
    });
  }

  private fileKey(
    rootId:
      string |
      undefined,
    relativePath: string,
  ): string {
    return `${rootId ?? ""}\u0000${relativePath}`;
  }
}
