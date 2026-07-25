import {
  REPO_MAP_SCHEMA_VERSION,
} from "./constants";

import {
  repoMapSchema,
} from "./schema";

import {
  RepoMapBudgetApplier,
} from "./RepoMapBudgetApplier";

import {
  RepoMapRanker,
} from "./ranking/RepoMapRanker";

import type {
  RepoMap,
  RepoMapBuildInput,
  RepoMapRankerOptions,
} from "./types";

export class RepoMapBuilder {
  private readonly ranker: RepoMapRanker;
  private readonly budgetApplier:
    RepoMapBudgetApplier;

  constructor(
    rankerOptions:
      RepoMapRankerOptions = {},
    ranker:
      RepoMapRanker =
        new RepoMapRanker(
          rankerOptions,
        ),
    budgetApplier:
      RepoMapBudgetApplier =
        new RepoMapBudgetApplier(),
  ) {
    this.ranker = ranker;
    this.budgetApplier =
      budgetApplier;
  }

  public build(
    input: RepoMapBuildInput,
  ): RepoMap {
    const startedAt = Date.now();

    this.throwIfAborted(
      input.abortSignal,
    );

    const ranking =
      this.ranker.rank({
        graph: input.graph,
        context:
          input.ranking ?? {},
        ...(input.abortSignal
          ? {
              abortSignal:
                input.abortSignal,
            }
          : {}),
      });

    this.throwIfAborted(
      input.abortSignal,
    );

    const budget =
      this.budgetApplier.apply(
        ranking.entries,
        input.budget,
      );

    const result: RepoMap = {
      schemaVersion:
        REPO_MAP_SCHEMA_VERSION,
      workspaceSnapshotId:
        input.graph
          .workspaceSnapshotId,
      codeIndexChangeToken:
        input.graph
          .codeIndexChangeToken,
      entries: budget.entries,
      statistics: {
        availableFiles:
          ranking
            .totalAvailableFiles,
        rankedFiles:
          ranking.entries.length,
        includedFiles:
          budget.entries.length,
        includedSymbols:
          budget.entries.reduce(
            (total, entry) =>
              total +
              entry.symbols.length,
            0,
          ),
        estimatedTokens:
          budget.estimatedTokens,
        durationMs: Math.max(
          0,
          Date.now() - startedAt,
        ),
      },
      status:
        ranking.complete &&
        !budget.truncated
          ? "complete"
          : "partial",
      generatedAt:
        new Date().toISOString(),
    };

    return repoMapSchema.parse(
      result,
    ) as RepoMap;
  }

  private throwIfAborted(
    abortSignal?: AbortSignal,
  ): void {
    if (!abortSignal?.aborted) {
      return;
    }

    const error = new Error(
      "Repo Map build was aborted.",
    );

    error.name = "AbortError";

    throw error;
  }
}
