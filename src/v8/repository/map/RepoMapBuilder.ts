import { REPO_MAP_SCHEMA_VERSION } from "./constants";

import { repoMapSchema } from "./schema";

import { RepoMapBudgetApplier } from "./RepoMapBudgetApplier";

import { RepoMapRanker } from "./rank";

import type { RepoMap, RepoMapBuildInput } from "./types";

export class RepoMapBuilder {
  constructor(
    private readonly ranker: RepoMapRanker,

    private readonly budgetApplier: RepoMapBudgetApplier = new RepoMapBudgetApplier(),
  ) {}

  public async build(input: RepoMapBuildInput): Promise<RepoMap> {
    const startedAt = Date.now();

    if (input.abortSignal?.aborted) {
      return this.cancelledMap(input, startedAt);
    }

    try {
      const ranking = await this.ranker.rank({
        snapshot: input.snapshot,
        catalog: input.catalog,

        context: input.ranking ?? {},

        ...(input.abortSignal
          ? {
              abortSignal: input.abortSignal,
            }
          : {}),
      });

      const budgetResult = this.budgetApplier.apply(
        ranking.entries,
        input.budget,
      );

      const map: RepoMap = {
        schemaVersion: REPO_MAP_SCHEMA_VERSION,

        workspaceSnapshotId: input.snapshot.snapshotId,

        entries: budgetResult.entries,

        statistics: {
          availableFiles: ranking.totalAvailableFiles,

          rankedFiles: ranking.entries.length,

          includedFiles: budgetResult.entries.length,

          includedSymbols: budgetResult.entries.reduce(
            (total, entry) => total + entry.symbols.length,
            0,
          ),

          estimatedTokens: budgetResult.estimatedTokens,

          durationMs: Math.max(0, Date.now() - startedAt),
        },

        status:
          budgetResult.truncated || !ranking.complete ? "partial" : "complete",

        generatedAt: new Date().toISOString(),
      };

      return repoMapSchema.parse(map) as RepoMap;
    } catch (error) {
      if (input.abortSignal?.aborted || this.isAbortError(error)) {
        return this.cancelledMap(input, startedAt);
      }

      throw error;
    }
  }

  private cancelledMap(input: RepoMapBuildInput, startedAt: number): RepoMap {
    const map: RepoMap = {
      schemaVersion: REPO_MAP_SCHEMA_VERSION,

      workspaceSnapshotId: input.snapshot.snapshotId,

      entries: [],

      statistics: {
        availableFiles: 0,
        rankedFiles: 0,
        includedFiles: 0,
        includedSymbols: 0,
        estimatedTokens: 0,

        durationMs: Math.max(0, Date.now() - startedAt),
      },

      status: "cancelled",

      generatedAt: new Date().toISOString(),
    };

    return repoMapSchema.parse(map) as RepoMap;
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
  }
}
