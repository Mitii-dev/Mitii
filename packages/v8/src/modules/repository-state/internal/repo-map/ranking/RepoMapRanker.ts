import {
  resolveRepoMapRankerOptions,
} from "../constants";

import type {
  RepoGraphFileNode,
  RepoGraphSymbolNode,
} from "../../repo-graph";

import type {
  RepoMapRankerOptions,
  RepoMapRankingContext,
  RepoMapRankingInput,
  RepoMapRankingResult,
} from "../types";

import {
  computePageRank,
} from "./pageRank";

import {
  scoreFile,
  tokenize,
} from "./repoMapFileScoring";

import {
  collectGraphSignals,
  collectSymbols,
} from "./repoMapGraphSignals";

import {
  buildPersonalization,
} from "./repoMapPersonalization";

import {
  preselectFiles,
} from "./repoMapPreselection";

import {
  isInScope,
  toRepoMapFile,
} from "./repoMapRankingHelpers";

export class RepoMapRanker {
  private readonly options:
    Required<RepoMapRankerOptions>;

  constructor(
    options: RepoMapRankerOptions = {},
  ) {
    this.options =
      resolveRepoMapRankerOptions(
        options,
      );

    this.validateOptions();
  }

  public rank(
    input: RepoMapRankingInput,
  ): RepoMapRankingResult {
    this.throwIfAborted(
      input.abortSignal,
    );

    this.validateContext(
      input.context,
    );

    const allFiles =
      input.graph.nodes
        .filter(
          (
            node,
          ): node is RepoGraphFileNode =>
            node.kind === "file",
        )
        .filter((node) =>
          isInScope(
            node,
            input.context,
          ),
        )
        .map((node) =>
          toRepoMapFile(node),
        );

    const totalAvailableFiles =
      allFiles.length;

    const files = preselectFiles(
      allFiles,
      input.context,
      this.options.maximumFiles,
    );

    const fileIds = new Set(
      files.map((file) => file.id),
    );

    const symbolsByFile =
      collectSymbols(
        input.graph.nodes.filter(
          (
            node,
          ): node is RepoGraphSymbolNode =>
            node.kind === "symbol",
        ),
        fileIds,
        this.options
          .maximumSymbolsPerFile,
      );

    const nodeToFileId =
      new Map<string, string>();

    for (const file of files) {
      nodeToFileId.set(
        file.id,
        file.id,
      );
    }

    for (
      const [
        fileId,
        symbols,
      ] of symbolsByFile
    ) {
      for (const symbol of symbols) {
        nodeToFileId.set(
          symbol.id,
          fileId,
        );
      }
    }

    const graphSignals =
      collectGraphSignals(
        input.graph,
        fileIds,
        nodeToFileId,
        input.context,
      );

    const personalization =
      buildPersonalization(
        files,
        input.context,
      );

    const pageRank =
      computePageRank(
        files.map((file) => file.id),
        graphSignals.pageRankEdges,
        {
          damping:
            this.options
              .pageRankDamping,
          iterations:
            this.options
              .pageRankIterations,
          personalization,
        },
      );

    const queryTerms = tokenize(
      input.context.query,
    );

    const entries = files
      .map((file) =>
        scoreFile({
          file,
          symbols:
            symbolsByFile.get(
              file.id,
            ) ?? [],
          queryTerms,
          context: input.context,
          pageRank:
            pageRank.get(file.id) ??
            0,
          inboundImportCount:
            graphSignals
              .inboundImports.get(
                file.id,
              ) ?? 0,
          outboundImportCount:
            graphSignals
              .outboundImports.get(
                file.id,
              ) ?? 0,
          inboundReferenceCount:
            graphSignals
              .inboundReferences.get(
                file.id,
              ) ?? 0,
          outboundReferenceCount:
            graphSignals
              .outboundReferences.get(
                file.id,
              ) ?? 0,
        }),
      )
      .sort(
        (left, right) =>
          right.score -
            left.score ||
          left.file.rootId.localeCompare(
            right.file.rootId,
          ) ||
          left.file.relativePath.localeCompare(
            right.file.relativePath,
          ),
      );

    return {
      files,
      entries,
      totalAvailableFiles,

      complete:
        input.graph.status ===
          "complete" &&
        files.length ===
          totalAvailableFiles,
    };
  }

  private validateContext(
    context: RepoMapRankingContext,
  ): void {
    if (
      context.rootIds &&
      new Set(context.rootIds).size !==
        context.rootIds.length
    ) {
      throw new RangeError(
        "RepoMapRankingContext.rootIds must be unique.",
      );
    }
  }

  private validateOptions(): void {
    const positiveIntegers = {
      maximumFiles:
        this.options.maximumFiles,
      maximumSymbolsPerFile:
        this.options
          .maximumSymbolsPerFile,
      pageRankIterations:
        this.options
          .pageRankIterations,
    };

    for (
      const [
        name,
        value,
      ] of Object.entries(
        positiveIntegers,
      )
    ) {
      if (
        !Number.isSafeInteger(value) ||
        value <= 0
      ) {
        throw new RangeError(
          `${name} must be a positive safe integer.`,
        );
      }
    }

    if (
      !Number.isFinite(
        this.options.pageRankDamping,
      ) ||
      this.options.pageRankDamping <=
        0 ||
      this.options.pageRankDamping >=
        1
    ) {
      throw new RangeError(
        "pageRankDamping must be greater than 0 and less than 1.",
      );
    }
  }

  private throwIfAborted(
    abortSignal?: AbortSignal,
  ): void {
    if (!abortSignal?.aborted) {
      return;
    }

    const error = new Error(
      "Repo Map ranking was aborted.",
    );

    error.name = "AbortError";

    throw error;
  }
}
