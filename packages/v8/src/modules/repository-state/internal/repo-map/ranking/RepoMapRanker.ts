import {
  REPO_MAP_DEFAULTS,
  REPO_MAP_PATTERNS,
  REPO_MAP_PRESELECTION_WEIGHTS,
  REPO_MAP_REASON_ORDER,
  REPO_MAP_SCORE_WEIGHTS,
  REPO_MAP_SYMBOL_KIND_PRIORITY,
  resolveRepoMapRankerOptions,
} from "../constants";

import {
  isImportantRepoMapFile,
} from "../importantFiles";

import type {
  RepoGraph,
  RepoGraphFileNode,
  RepoGraphSymbolNode,
} from "../../repo-graph";

import type {
  PageRankEdge,
  RepoMapEntry,
  RepoMapFile,
  RepoMapFileSelection,
  RepoMapRankerOptions,
  RepoMapRankingContext,
  RepoMapRankingInput,
  RepoMapRankingResult,
  RepoMapScoreReason,
  RepoMapScoreReasonType,
  RepoMapSymbol,
} from "../types";

import {
  computePageRank,
} from "./pageRank";

export class RepoMapRanker {
  private readonly options:
    Required<RepoMapRankerOptions>;

  constructor(
    options:
      RepoMapRankerOptions = {},
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
          this.isInScope(
            node,
            input.context,
          ),
        )
        .map((node) =>
          this.toRepoMapFile(node),
        );

    const totalAvailableFiles =
      allFiles.length;

    const files =
      this.preselectFiles(
        allFiles,
        input.context,
      );

    const fileIds =
      new Set(
        files.map(
          (file) => file.id,
        ),
      );

    const symbolsByFile =
      this.collectSymbols(
        input.graph.nodes.filter(
          (
            node,
          ): node is RepoGraphSymbolNode =>
            node.kind === "symbol",
        ),
        fileIds,
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
      this.collectGraphSignals(
        input.graph,
        fileIds,
        nodeToFileId,
        input.context,
      );

    const personalization =
      this.buildPersonalization(
        files,
        input.context,
      );

    const pageRank =
      computePageRank(
        files.map(
          (file) => file.id,
        ),
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

    const queryTerms =
      this.tokenize(
        input.context.query,
      );

    const entries =
      files
        .map((file) =>
          this.scoreFile({
            file,
            symbols:
              symbolsByFile.get(
                file.id,
              ) ?? [],
            queryTerms,
            context:
              input.context,
            pageRank:
              pageRank.get(
                file.id,
              ) ?? 0,
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

  private preselectFiles(
    files: readonly RepoMapFile[],
    context:
      RepoMapRankingContext,
  ): RepoMapFile[] {
    const queryTerms =
      this.tokenize(
        context.query,
      );

    return [...files]
      .sort((left, right) => {
        const leftPriority =
          this.preselectionPriority(
            left,
            context,
            queryTerms,
          );

        const rightPriority =
          this.preselectionPriority(
            right,
            context,
            queryTerms,
          );

        return (
          rightPriority -
            leftPriority ||
          left.rootId.localeCompare(
            right.rootId,
          ) ||
          left.relativePath.localeCompare(
            right.relativePath,
          )
        );
      })
      .slice(
        0,
        this.options.maximumFiles,
      );
  }

  private preselectionPriority(
    file: RepoMapFile,
    context:
      RepoMapRankingContext,
    queryTerms: readonly string[],
  ): number {
    let score = 0;

    if (
      this.matchesSelection(
        file,
        context.currentFile,
      )
    ) {
      score +=
        REPO_MAP_PRESELECTION_WEIGHTS
          .CURRENT_FILE;
    }

    if (
      isImportantRepoMapFile(
        file.relativePath,
      )
    ) {
      score +=
        REPO_MAP_PRESELECTION_WEIGHTS
          .IMPORTANT_FILE;
    }

    if (
      this.matchesAnySelection(
        file,
        context.gitDiffFiles,
      )
    ) {
      score +=
        REPO_MAP_PRESELECTION_WEIGHTS
          .GIT_DIFF_FILE;
    }

    if (
      this.matchesAnySelection(
        file,
        context.openFiles,
      )
    ) {
      score +=
        REPO_MAP_PRESELECTION_WEIGHTS
          .OPEN_FILE;
    }

    if (
      this.matchesAnySelection(
        file,
        context.diagnosticFiles,
      )
    ) {
      score +=
        REPO_MAP_PRESELECTION_WEIGHTS
          .DIAGNOSTIC_FILE;
    }

    if (
      this.matchesAnySelection(
        file,
        context.recentEditFiles,
      )
    ) {
      score +=
        REPO_MAP_PRESELECTION_WEIGHTS
          .RECENT_EDIT_FILE;
    }

    const normalizedPath =
      file.relativePath.toLowerCase();

    score +=
      queryTerms.filter((term) =>
        normalizedPath.includes(
          term,
        ),
      ).length *
      REPO_MAP_PRESELECTION_WEIGHTS
        .QUERY_PATH_TERM;

    return score;
  }

  private collectSymbols(
    nodes:
      readonly RepoGraphSymbolNode[],
    fileIds: ReadonlySet<string>,
  ): ReadonlyMap<
    string,
    RepoMapSymbol[]
  > {
    const result =
      new Map<
        string,
        RepoMapSymbol[]
      >();

    for (const fileId of fileIds) {
      result.set(fileId, []);
    }

    for (const node of nodes) {
      const symbols =
        result.get(node.fileId);

      if (!symbols) {
        continue;
      }

      symbols.push({
        id: node.id,
        fileId: node.fileId,
        name: node.name,
        kind: node.symbolKind,

        ...(node.parentSymbolId
          ? {
              parentSymbolId:
                node.parentSymbolId,
            }
          : {}),

        ...(node.exported !==
        undefined
          ? {
              exported:
                node.exported,
            }
          : {}),

        ...(node.signature
          ? {
              signature:
                node.signature,
            }
          : {}),

        ...(node.startLine !==
        undefined
          ? {
              startLine:
                node.startLine,
            }
          : {}),

        ...(node.endLine !==
        undefined
          ? {
              endLine:
                node.endLine,
            }
          : {}),
      });
    }

    for (const symbols of result.values()) {
      symbols.sort(
        (left, right) =>
          (REPO_MAP_SYMBOL_KIND_PRIORITY[
            right.kind
          ] ?? 0) -
            (REPO_MAP_SYMBOL_KIND_PRIORITY[
              left.kind
            ] ?? 0) ||
          (left.startLine ?? 0) -
            (right.startLine ?? 0) ||
          left.name.localeCompare(
            right.name,
          ),
      );

      symbols.splice(
        this.options
          .maximumSymbolsPerFile,
      );
    }

    return result;
  }

  private collectGraphSignals(
    graph: RepoGraph,
    fileIds: ReadonlySet<string>,
    nodeToFileId:
      ReadonlyMap<string, string>,
    context: RepoMapRankingContext,
  ): {
    inboundImports:
      ReadonlyMap<string, number>;
    outboundImports:
      ReadonlyMap<string, number>;
    inboundReferences:
      ReadonlyMap<string, number>;
    outboundReferences:
      ReadonlyMap<string, number>;
    pageRankEdges: PageRankEdge[];
  } {
    const inboundImports =
      new Map<string, number>();
    const outboundImports =
      new Map<string, number>();
    const inboundReferences =
      new Map<string, number>();
    const outboundReferences =
      new Map<string, number>();
    const pageRankEdges:
      PageRankEdge[] = [];

    const symbolById =
      new Map<
        string,
        {
          name: string;
          fileId: string;
        }
      >();
    const definerCountByName =
      new Map<string, number>();

    for (const node of graph.nodes) {
      if (node.kind !== "symbol") {
        continue;
      }
      symbolById.set(node.id, {
        name: node.name,
        fileId: node.fileId,
      });
      definerCountByName.set(
        node.name,
        (definerCountByName.get(
          node.name,
        ) ?? 0) + 1,
      );
    }

    const mentionedIdents =
      this.collectMentionedIdents(
        context,
      );
    const chatFileIds =
      this.collectChatFileIds(
        graph,
        fileIds,
        context,
      );

    for (const edge of graph.edges) {
      if (
        edge.type !== "imports" &&
        edge.type !== "calls" &&
        edge.type !== "references"
      ) {
        continue;
      }

      const fromFileId =
        nodeToFileId.get(
          edge.fromNodeId,
        );

      const toFileId =
        nodeToFileId.get(
          edge.toNodeId,
        );

      if (
        !fromFileId ||
        !toFileId ||
        !fileIds.has(fromFileId) ||
        !fileIds.has(toFileId)
      ) {
        continue;
      }

      const count =
        Math.max(
          1,
          edge.weight,
        );

      if (edge.type === "imports") {
        this.increment(
          outboundImports,
          fromFileId,
          count,
        );

        this.increment(
          inboundImports,
          toFileId,
          count,
        );

        if (
          fromFileId !== toFileId
        ) {
          pageRankEdges.push({
            from: fromFileId,
            to: toFileId,
            weight:
              count *
              REPO_MAP_SCORE_WEIGHTS
                .IMPORT_EDGE,
          });
        }

        continue;
      }

      this.increment(
        outboundReferences,
        fromFileId,
        count,
      );

      this.increment(
        inboundReferences,
        toFileId,
        count,
      );

      if (
        fromFileId !== toFileId
      ) {
        const typeWeight =
          edge.type === "calls"
            ? REPO_MAP_SCORE_WEIGHTS
                .CALL_EDGE
            : REPO_MAP_SCORE_WEIGHTS
                .REFERENCE_EDGE;

        const definer =
          symbolById.get(
            edge.toNodeId,
          );
        const ident =
          definer?.name ?? "";
        const identMul =
          this.identifierEdgeMultiplier(
            ident,
            mentionedIdents,
            definerCountByName.get(
              ident,
            ) ?? 1,
          );
        const chatMul =
          chatFileIds.has(
            fromFileId,
          )
            ? REPO_MAP_SCORE_WEIGHTS
                .CHAT_FILE_REFERRER_MULTIPLIER
            : 1;

        pageRankEdges.push({
          from: fromFileId,
          to: toFileId,
          weight:
            Math.sqrt(count) *
            typeWeight *
            identMul *
            chatMul,
        });
      }
    }

    return {
      inboundImports,
      outboundImports,
      inboundReferences,
      outboundReferences,
      pageRankEdges,
    };
  }

  private scoreFile(input: {
    file: RepoMapFile;
    symbols:
      readonly RepoMapSymbol[];
    queryTerms: readonly string[];
    context: RepoMapRankingContext;
    pageRank: number;
    inboundImportCount: number;
    outboundImportCount: number;
    inboundReferenceCount: number;
    outboundReferenceCount: number;
  }): RepoMapEntry {
    const reasons:
      RepoMapScoreReason[] = [];

    let score = 0;

    score += this.addSelectionSignal(
      reasons,
      input.file,
      input.context.currentFile,
      "current_file",
      REPO_MAP_SCORE_WEIGHTS
        .CURRENT_FILE,
    );

    if (
      isImportantRepoMapFile(
        input.file.relativePath,
      )
    ) {
      score +=
        REPO_MAP_SCORE_WEIGHTS
          .IMPORTANT_FILE;
      reasons.push({
        type: "important_file",
        score:
          REPO_MAP_SCORE_WEIGHTS
            .IMPORTANT_FILE,
        evidence:
          `"${input.file.relativePath}" matched an important project root file.`,
      });
    }

    score +=
      this.addSelectionListSignal(
        reasons,
        input.file,
        input.context.openFiles,
        "open_file",
        REPO_MAP_SCORE_WEIGHTS
          .OPEN_FILE,
      );

    score +=
      this.addSelectionListSignal(
        reasons,
        input.file,
        input.context.gitDiffFiles,
        "git_diff",
        REPO_MAP_SCORE_WEIGHTS
          .GIT_DIFF_FILE,
      );

    score +=
      this.addSelectionListSignal(
        reasons,
        input.file,
        input.context
          .diagnosticFiles,
        "diagnostic",
        REPO_MAP_SCORE_WEIGHTS
          .DIAGNOSTIC_FILE,
      );

    score +=
      this.addSelectionListSignal(
        reasons,
        input.file,
        input.context
          .recentEditFiles,
        "recent_edit",
        REPO_MAP_SCORE_WEIGHTS
          .RECENT_EDIT_FILE,
      );

    const normalizedPath =
      input.file.relativePath.toLowerCase();
    const normalizedQuery =
      input.context.query?.toLowerCase() ?? "";

    if (
      normalizedQuery.includes(
        normalizedPath,
      )
    ) {
      score +=
        REPO_MAP_SCORE_WEIGHTS
          .QUERY_EXACT_PATH_MATCH;

      reasons.push({
        type: "query_path",
        score:
          REPO_MAP_SCORE_WEIGHTS
            .QUERY_EXACT_PATH_MATCH,
        evidence:
          `Path "${input.file.relativePath}" was explicitly mentioned in the query.`,
      });
    }

    for (
      const term of
      input.queryTerms
    ) {
      if (
        normalizedPath.includes(
          term,
        )
      ) {
        score +=
          REPO_MAP_SCORE_WEIGHTS
            .QUERY_PATH_MATCH;

        reasons.push({
          type: "query_path",
          score:
            REPO_MAP_SCORE_WEIGHTS
              .QUERY_PATH_MATCH,
          evidence:
            `Path matched query term "${term}".`,
        });
      }

      for (
        const symbol of
        input.symbols
      ) {
        const normalizedName =
          symbol.name.toLowerCase();

        if (
          normalizedName === term
        ) {
          score +=
            REPO_MAP_SCORE_WEIGHTS
              .QUERY_SYMBOL_EXACT_MATCH;

          reasons.push({
            type: "query_symbol",
            score:
              REPO_MAP_SCORE_WEIGHTS
                .QUERY_SYMBOL_EXACT_MATCH,
            evidence:
              `Symbol "${symbol.name}" exactly matched query term "${term}".`,
          });

          continue;
        }

        if (
          normalizedName.includes(
            term,
          )
        ) {
          score +=
            REPO_MAP_SCORE_WEIGHTS
              .QUERY_SYMBOL_PARTIAL_MATCH;

          reasons.push({
            type: "query_symbol",
            score:
              REPO_MAP_SCORE_WEIGHTS
                .QUERY_SYMBOL_PARTIAL_MATCH,
            evidence:
              `Symbol "${symbol.name}" partially matched query term "${term}".`,
          });
        }
      }
    }

    score += this.addCountSignal(
      reasons,
      "inbound_import",
      input.inboundImportCount,
      REPO_MAP_SCORE_WEIGHTS
        .MAXIMUM_INBOUND_IMPORT_COUNT,
      REPO_MAP_SCORE_WEIGHTS
        .INBOUND_IMPORT_MULTIPLIER,
      "inbound imports",
    );

    score += this.addCountSignal(
      reasons,
      "outbound_import",
      input.outboundImportCount,
      REPO_MAP_SCORE_WEIGHTS
        .MAXIMUM_OUTBOUND_IMPORT_COUNT,
      REPO_MAP_SCORE_WEIGHTS
        .OUTBOUND_IMPORT_MULTIPLIER,
      "outbound imports",
    );

    score += this.addCountSignal(
      reasons,
      "inbound_reference",
      input.inboundReferenceCount,
      REPO_MAP_SCORE_WEIGHTS
        .MAXIMUM_INBOUND_REFERENCE_COUNT,
      REPO_MAP_SCORE_WEIGHTS
        .INBOUND_REFERENCE_MULTIPLIER,
      "inbound references",
    );

    score += this.addCountSignal(
      reasons,
      "outbound_reference",
      input.outboundReferenceCount,
      REPO_MAP_SCORE_WEIGHTS
        .MAXIMUM_OUTBOUND_REFERENCE_COUNT,
      REPO_MAP_SCORE_WEIGHTS
        .OUTBOUND_REFERENCE_MULTIPLIER,
      "outbound references",
    );

    const pageRankScore =
      input.pageRank *
      REPO_MAP_SCORE_WEIGHTS
        .PAGE_RANK_MULTIPLIER;

    if (pageRankScore > 0) {
      score += pageRankScore;

      reasons.push({
        type: "page_rank",
        score: pageRankScore,
        evidence:
          `File graph PageRank is ${input.pageRank.toFixed(
            REPO_MAP_DEFAULTS
              .PAGE_RANK_EVIDENCE_DECIMAL_PLACES,
          )}.`,
      });
    }

    const basename =
      input.file.relativePath
        .split("/")
        .pop() ?? "";

    if (
      REPO_MAP_PATTERNS
        .ENTRY_POINT.test(basename)
    ) {
      score +=
        REPO_MAP_SCORE_WEIGHTS
          .ENTRY_POINT;

      reasons.push({
        type: "entry_point",
        score:
          REPO_MAP_SCORE_WEIGHTS
            .ENTRY_POINT,
        evidence:
          `"${basename}" matches a conventional entry-point filename.`,
      });
    }

    reasons.sort(
      (left, right) =>
        REPO_MAP_REASON_ORDER[
          left.type
        ] -
          REPO_MAP_REASON_ORDER[
            right.type
          ] ||
        left.evidence.localeCompare(
          right.evidence,
        ),
    );

    return {
      file: input.file,
      symbols:
        [...input.symbols],
      score,
      pageRank:
        input.pageRank,
      inboundImportCount:
        input.inboundImportCount,
      outboundImportCount:
        input.outboundImportCount,
      inboundReferenceCount:
        input.inboundReferenceCount,
      outboundReferenceCount:
        input.outboundReferenceCount,
      reasons,
    };
  }

  private buildPersonalization(
    files:
      readonly RepoMapFile[],
    context:
      RepoMapRankingContext,
  ): Map<string, number> {
    const result =
      new Map<string, number>();
    const mentionedIdents =
      this.collectMentionedIdents(
        context,
      );

    for (const file of files) {
      let weight =
        REPO_MAP_SCORE_WEIGHTS
          .PERSONALIZATION_BASE;

      if (
        this.matchesSelection(
          file,
          context.currentFile,
        )
      ) {
        weight +=
          REPO_MAP_SCORE_WEIGHTS
            .PERSONALIZATION_CURRENT_FILE;
      }

      if (
        this.matchesAnySelection(
          file,
          context.openFiles,
        )
      ) {
        weight +=
          REPO_MAP_SCORE_WEIGHTS
            .PERSONALIZATION_OPEN_FILE;
      }

      if (
        this.matchesAnySelection(
          file,
          context.gitDiffFiles,
        )
      ) {
        weight +=
          REPO_MAP_SCORE_WEIGHTS
            .PERSONALIZATION_GIT_DIFF_FILE;
      }

      if (
        this.matchesAnySelection(
          file,
          context.diagnosticFiles,
        )
      ) {
        weight +=
          REPO_MAP_SCORE_WEIGHTS
            .PERSONALIZATION_DIAGNOSTIC_FILE;
      }

      if (
        this.matchesAnySelection(
          file,
          context.recentEditFiles,
        )
      ) {
        weight +=
          REPO_MAP_SCORE_WEIGHTS
            .PERSONALIZATION_RECENT_EDIT_FILE;
      }

      if (
        this.pathMentionsIdent(
          file.relativePath,
          mentionedIdents,
        )
      ) {
        weight +=
          REPO_MAP_SCORE_WEIGHTS
            .PERSONALIZATION_MENTIONED_PATH_COMPONENT;
      }

      if (
        isImportantRepoMapFile(
          file.relativePath,
        )
      ) {
        weight +=
          REPO_MAP_SCORE_WEIGHTS
            .PERSONALIZATION_IMPORTANT_FILE;
      }

      result.set(
        file.id,
        weight,
      );
    }

    return result;
  }

  private addSelectionSignal(
    reasons:
      RepoMapScoreReason[],
    file: RepoMapFile,
    selection:
      RepoMapFileSelection | undefined,
    type:
      RepoMapScoreReasonType,
    weight: number,
  ): number {
    if (
      !this.matchesSelection(
        file,
        selection,
      )
    ) {
      return 0;
    }

    reasons.push({
      type,
      score: weight,
      evidence:
        `"${file.relativePath}" matched ${type}.`,
    });

    return weight;
  }

  private addSelectionListSignal(
    reasons:
      RepoMapScoreReason[],
    file: RepoMapFile,
    selections:
      readonly RepoMapFileSelection[] |
      undefined,
    type:
      RepoMapScoreReasonType,
    weight: number,
  ): number {
    if (
      !this.matchesAnySelection(
        file,
        selections,
      )
    ) {
      return 0;
    }

    reasons.push({
      type,
      score: weight,
      evidence:
        `"${file.relativePath}" matched ${type}.`,
    });

    return weight;
  }

  private addCountSignal(
    reasons:
      RepoMapScoreReason[],
    type:
      RepoMapScoreReasonType,
    count: number,
    maximumCount: number,
    multiplier: number,
    label: string,
  ): number {
    const score =
      Math.min(
        count,
        maximumCount,
      ) * multiplier;

    if (score <= 0) {
      return 0;
    }

    reasons.push({
      type,
      score,
      evidence:
        `The file has ${count} ${label}.`,
    });

    return score;
  }


  private collectMentionedIdents(
    context: RepoMapRankingContext,
  ): Set<string> {
    const idents = new Set<string>();
    for (const term of this.tokenize(
      context.query,
    )) {
      if (
        term.length >=
        REPO_MAP_DEFAULTS
          .MINIMUM_QUERY_TERM_LENGTH
      ) {
        idents.add(term);
      }
    }

    const pathSelections = [
      context.currentFile,
      ...(context.openFiles ?? []),
      ...(context.gitDiffFiles ?? []),
    ];
    for (const selection of pathSelections) {
      if (!selection) continue;
      const relativePath =
        typeof selection === "string"
          ? selection
          : selection.relativePath;
      for (const part of relativePath
        .toLowerCase()
        .split(/[/._-]+/)) {
        if (
          part.length >=
          REPO_MAP_DEFAULTS
            .MINIMUM_QUERY_TERM_LENGTH
        ) {
          idents.add(part);
        }
      }
    }

    return idents;
  }

  private collectChatFileIds(
    graph: RepoGraph,
    fileIds: ReadonlySet<string>,
    context: RepoMapRankingContext,
  ): Set<string> {
    const chatIds = new Set<string>();
    for (const node of graph.nodes) {
      if (
        node.kind !== "file" ||
        !fileIds.has(node.id)
      ) {
        continue;
      }
      const file = this.toRepoMapFile(node);
      if (
        this.matchesSelection(
          file,
          context.currentFile,
        ) ||
        this.matchesAnySelection(
          file,
          context.openFiles,
        )
      ) {
        chatIds.add(file.id);
      }
    }
    return chatIds;
  }

  private identifierEdgeMultiplier(
    ident: string,
    mentionedIdents: ReadonlySet<string>,
    definerCount: number,
  ): number {
    if (!ident) {
      return 1;
    }

    let mul = 1;
    const lower = ident.toLowerCase();
    if (
      mentionedIdents.has(lower) ||
      mentionedIdents.has(ident)
    ) {
      mul *=
        REPO_MAP_SCORE_WEIGHTS
          .IDENT_MENTIONED_MULTIPLIER;
    }

    const isSnake =
      ident.includes("_") &&
      /[a-zA-Z]/.test(ident);
    const isKebab =
      ident.includes("-") &&
      /[a-zA-Z]/.test(ident);
    const isCamel =
      /[A-Z]/.test(ident) &&
      /[a-z]/.test(ident);
    if (
      (isSnake || isKebab || isCamel) &&
      ident.length >=
        REPO_MAP_SCORE_WEIGHTS
          .IDENT_QUALITY_MINIMUM_LENGTH
    ) {
      mul *=
        REPO_MAP_SCORE_WEIGHTS
          .IDENT_QUALITY_MULTIPLIER;
    }

    if (ident.startsWith("_")) {
      mul *=
        REPO_MAP_SCORE_WEIGHTS
          .IDENT_PRIVATE_MULTIPLIER;
    }

    if (
      definerCount >
      REPO_MAP_SCORE_WEIGHTS
        .IDENT_HIGH_FANIN_THRESHOLD
    ) {
      mul *=
        REPO_MAP_SCORE_WEIGHTS
          .IDENT_HIGH_FANIN_MULTIPLIER;
    }

    return mul;
  }

  private pathMentionsIdent(
    relativePath: string,
    mentionedIdents: ReadonlySet<string>,
  ): boolean {
    if (mentionedIdents.size === 0) {
      return false;
    }
    const components = relativePath
      .toLowerCase()
      .split(/[/._-]+/)
      .filter(
        (part) =>
          part.length >=
          REPO_MAP_DEFAULTS
            .MINIMUM_QUERY_TERM_LENGTH,
      );
    return components.some((part) =>
      mentionedIdents.has(part),
    );
  }

  private matchesAnySelection(
    file: RepoMapFile,
    selections:
      readonly RepoMapFileSelection[] |
      undefined,
  ): boolean {
    return (
      selections?.some(
        (selection) =>
          this.matchesSelection(
            file,
            selection,
          ),
      ) ?? false
    );
  }

  private matchesSelection(
    file: RepoMapFile,
    selection:
      RepoMapFileSelection | undefined,
  ): boolean {
    if (!selection) {
      return false;
    }

    if (
      typeof selection === "string"
    ) {
      return (
        this.normalizePath(
          selection,
        ) === file.relativePath
      );
    }

    return (
      this.normalizePath(
        selection.relativePath,
      ) === file.relativePath &&
      (!selection.rootId ||
        selection.rootId ===
          file.rootId)
    );
  }

  private isInScope(
    file: RepoGraphFileNode,
    context:
      RepoMapRankingContext,
  ): boolean {
    if (
      context.rootIds &&
      !context.rootIds.includes(
        file.rootId,
      )
    ) {
      return false;
    }

    const prefix =
      this.normalizePath(
        context.folderPrefix ?? "",
      );

    return (
      !prefix ||
      file.relativePath === prefix ||
      file.relativePath.startsWith(
        `${prefix}/`,
      )
    );
  }

  private toRepoMapFile(
    node: RepoGraphFileNode,
  ): RepoMapFile {
    return {
      id: node.id,
      rootId: node.rootId,
      relativePath:
        node.relativePath,

      ...(node.projectId
        ? {
            projectId:
              node.projectId,
          }
        : {}),

      ...(node.language
        ? {
            language:
              node.language,
          }
        : {}),

      ...(node.size !== undefined
        ? {
            size: node.size,
          }
        : {}),

      ...(node.modifiedAt
        ? {
            modifiedAt:
              node.modifiedAt,
          }
        : {}),

      ...(node.contentHash
        ? {
            contentHash:
              node.contentHash,
          }
        : {}),
    };
  }

  private tokenize(
    query: string | undefined,
  ): string[] {
    if (!query?.trim()) {
      return [];
    }

    return [
      ...new Set(
        (
          query.toLowerCase().match(
            REPO_MAP_PATTERNS
              .QUERY_TERM,
          ) ?? []
        ).filter(
          (term) =>
            term.length >=
              REPO_MAP_DEFAULTS
                .MINIMUM_QUERY_TERM_LENGTH,
        ),
      ),
    ];
  }

  private increment(
    values:
      Map<string, number>,
    key: string,
    amount: number,
  ): void {
    values.set(
      key,
      (values.get(key) ?? 0) +
        amount,
    );
  }

  private normalizePath(
    value: string,
  ): string {
    return value
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\.\/+/, "")
      .replace(/\/+/g, "/")
      .replace(/\/+$/, "");
  }

  private validateContext(
    context:
      RepoMapRankingContext,
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
