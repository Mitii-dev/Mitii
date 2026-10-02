import {
  REPO_MAP_DEFAULTS,
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
  RepoMapBudget,
  RepoMapBuildInput,
  RepoMapRankerOptions,
  RepoMapRankingContext,
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

    const rankingContext =
      input.ranking ?? {};

    const ranking =
      this.ranker.rank({
        graph: input.graph,
        context: rankingContext,
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
        this.resolveBudget(
          input.budget,
          rankingContext,
        ),
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

  /**
   * When ranking has no chat/open/current files, enlarge the token budget
   * (aider `map_mul_no_files`) so cold-start maps stay informative.
   */
  private resolveBudget(
    budget: RepoMapBudget | undefined,
    context: RepoMapRankingContext,
  ): RepoMapBudget | undefined {
    if (this.hasSessionFiles(context)) {
      return budget;
    }

    const baseTokens =
      budget?.maximumEstimatedTokens ??
      REPO_MAP_DEFAULTS
        .MAXIMUM_ESTIMATED_TOKENS;

    const expanded = Math.min(
      REPO_MAP_DEFAULTS
        .MAXIMUM_NO_SESSION_TOKEN_BUDGET,
      baseTokens *
        REPO_MAP_DEFAULTS.MAP_MUL_NO_FILES,
    );

    if (
      budget?.maximumEstimatedTokens !==
        undefined &&
      expanded <=
        budget.maximumEstimatedTokens
    ) {
      return budget;
    }

    return {
      ...(budget ?? {}),
      maximumEstimatedTokens: expanded,
    };
  }

  private hasSessionFiles(
    context: RepoMapRankingContext,
  ): boolean {
    return Boolean(
      context.currentFile ||
        (context.openFiles &&
          context.openFiles.length > 0) ||
        (context.gitDiffFiles &&
          context.gitDiffFiles.length >
            0) ||
        (context.diagnosticFiles &&
          context.diagnosticFiles
            .length > 0) ||
        (context.recentEditFiles &&
          context.recentEditFiles
            .length > 0),
    );
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
