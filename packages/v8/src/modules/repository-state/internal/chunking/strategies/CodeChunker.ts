import {
  CHUNKING_CODE_EXTENSIONS,
  CHUNKING_CODE_LANGUAGES,
  CHUNKING_IDS,
  CHUNKING_MESSAGES,
  CHUNKING_PATTERNS,
  CHUNKING_STRATEGY_PRIORITIES,
} from "../constants";

import {
  ChunkTextIndex,
} from "../ChunkTextIndex";

import type {
  SourceAnalysisSymbol,
} from "../../source-analysis/types";

import type {
  ChunkingStrategy,
  ChunkingStrategyContext,
  ChunkingStrategyResult,
  ChunkingWarning,
  RawChunkSpan,
} from "../types";

interface RangedSymbol {
  symbol: SourceAnalysisSymbol;
  startOffset: number;
  endOffset: number;
}

export class CodeChunker
  implements ChunkingStrategy
{
  public readonly id =
    CHUNKING_IDS.CODE_STRATEGY;

  public readonly priority =
    CHUNKING_STRATEGY_PRIORITIES
      .CODE;

  public supports(
    context: ChunkingStrategyContext,
  ): boolean {
    if (
      context.sourceAnalysis &&
      context.sourceAnalysis
        .symbols.length > 0
    ) {
      return true;
    }

    if (
      context.language &&
      CHUNKING_CODE_LANGUAGES
        .has(
          context.language
            .toLowerCase(),
        )
    ) {
      return true;
    }

    return CHUNKING_CODE_EXTENSIONS
      .has(
        this.extensionOf(
          context.relativePath,
        ),
      );
  }

  public createSpans(
    context: ChunkingStrategyContext,
  ): ChunkingStrategyResult {
    const warnings:
      ChunkingWarning[] = [];

    const symbolSpans =
      this.createSymbolSpans(
        context,
        warnings,
      );

    if (
      symbolSpans.length > 0
    ) {
      return {
        spans:
          this.fillGaps(
            symbolSpans,
            context.content.length,
          ),
        warnings,
      };
    }

    if (
      context.sourceAnalysis &&
      context.sourceAnalysis
        .symbols.length > 0
    ) {
      warnings.push({
        code:
          "source_analysis_unusable",
        message:
          CHUNKING_MESSAGES
            .SOURCE_ANALYSIS_UNUSABLE,
        strategyId: this.id,
      });
    }

    return {
      spans:
        this.createDeclarationSpans(
          context.content,
        ),
      warnings,
    };
  }

  private createSymbolSpans(
    context: ChunkingStrategyContext,
    warnings: ChunkingWarning[],
  ): RawChunkSpan[] {
    const ranged =
      this.collectRangedSymbols(
        context,
      );

    if (ranged.length === 0) {
      return [];
    }

    const byId =
      new Map(
        ranged.map((node) => [
          node.symbol.localId,
          node,
        ]),
      );

    const childrenByParent =
      new Map<string, RangedSymbol[]>();

    const roots: RangedSymbol[] = [];

    for (const node of ranged) {
      const parentId =
        node.symbol.parentLocalId;

      if (
        parentId &&
        byId.has(parentId)
      ) {
        const siblings =
          childrenByParent.get(
            parentId,
          ) ?? [];

        siblings.push(node);
        childrenByParent.set(
          parentId,
          siblings,
        );
      } else {
        roots.push(node);
      }
    }

    const expanded: RawChunkSpan[] = [];

    for (
      const root of this.removeOverlappingSymbols(
        this.sortByRange(roots),
      )
    ) {
      expanded.push(
        ...this.expandSymbol(
          root,
          childrenByParent,
          context.content,
          context.options
            .maximumChunkCharacters,
          warnings,
        ),
      );
    }

    return this.sortSpans(expanded);
  }

  private collectRangedSymbols(
    context: ChunkingStrategyContext,
  ): RangedSymbol[] {
    const analysis =
      context.sourceAnalysis;

    if (
      !analysis ||
      (
        analysis.status !==
          "complete" &&
        analysis.status !==
          "partial"
      )
    ) {
      return [];
    }

    const textIndex =
      new ChunkTextIndex(
        context.content,
      );

    const ranged: RangedSymbol[] = [];

    for (const symbol of analysis.symbols) {
      const startOffset =
        textIndex.lineStartOffset(
          symbol.startLine,
        );

      const endOffset =
        textIndex.lineEndOffsetExclusive(
          symbol.endLine ??
            symbol.startLine,
        );

      if (
        startOffset === undefined ||
        endOffset === undefined ||
        endOffset <= startOffset
      ) {
        continue;
      }

      ranged.push({
        symbol,
        startOffset,
        endOffset,
      });
    }

    return ranged;
  }

  private expandSymbol(
    node: RangedSymbol,
    childrenByParent: ReadonlyMap<string, RangedSymbol[]>,
    content: string,
    maximumChunkCharacters: number,
    warnings: ChunkingWarning[],
  ): RawChunkSpan[] {
    const children =
      this.sortByRange(
        childrenByParent.get(
          node.symbol.localId,
        ) ?? [],
      );

    const size =
      node.endOffset - node.startOffset;

    if (
      size <= maximumChunkCharacters ||
      children.length === 0
    ) {
      return [
        {
          startOffset: node.startOffset,
          endOffset: node.endOffset,
          kind: "code_symbol",
          title: node.symbol.name,
          symbolLocalId: node.symbol.localId,
        },
      ];
    }

    const overview =
      this.collapseParentContent(
        content,
        node,
        children,
        maximumChunkCharacters,
      );

    warnings.push({
      code: "collapsed_parent",
      message:
        CHUNKING_MESSAGES.COLLAPSED_PARENT,
      strategyId: this.id,
      startOffset: node.startOffset,
      endOffset: node.endOffset,
    });

    const spans: RawChunkSpan[] = [
      {
        startOffset: node.startOffset,
        endOffset: node.endOffset,
        kind: "code_region",
        title: node.symbol.name,
        symbolLocalId: node.symbol.localId,
        contentOverride: overview,
      },
    ];

    for (const child of children) {
      spans.push(
        ...this.expandSymbol(
          child,
          childrenByParent,
          content,
          maximumChunkCharacters,
          warnings,
        ),
      );
    }

    return spans;
  }

  private collapseParentContent(
    content: string,
    parent: RangedSymbol,
    children: readonly RangedSymbol[],
    maximumCharacters: number,
  ): string {
    let text = content.slice(
      parent.startOffset,
      parent.endOffset,
    );

    const ordered = [...children].sort(
      (left, right) =>
        right.startOffset - left.startOffset,
    );

    for (const child of ordered) {
      const relStart =
        child.startOffset - parent.startOffset;
      const relEnd =
        child.endOffset - parent.startOffset;

      if (
        relStart < 0 ||
        relEnd > text.length ||
        relEnd <= relStart
      ) {
        continue;
      }

      const placeholder =
        this.collapseChildPlaceholder(
          text.slice(relStart, relEnd),
        );

      text =
        text.slice(0, relStart) +
        placeholder +
        text.slice(relEnd);
    }

    if (text.length <= maximumCharacters) {
      return text;
    }

    const cut = text.lastIndexOf(
      "\n",
      maximumCharacters,
    );

    return text.slice(
      0,
      cut > maximumCharacters / 2
        ? cut
        : maximumCharacters,
    );
  }

  private collapseChildPlaceholder(
    childText: string,
  ): string {
    const openBrace = childText.indexOf("{");
    const closeBrace = childText.lastIndexOf("}");

    if (
      openBrace >= 0 &&
      closeBrace > openBrace
    ) {
      return (
        childText.slice(0, openBrace).trimEnd() +
        " { ... }"
      );
    }

    const colon = childText.indexOf(":");

    if (colon >= 0 && colon < 120) {
      return childText.slice(0, colon + 1) + " ...";
    }

    const newline = childText.indexOf("\n");

    if (newline >= 0) {
      return childText.slice(0, newline) + "\n...";
    }

    return childText;
  }

  private createDeclarationSpans(
    content: string,
  ): RawChunkSpan[] {
    if (!content) {
      return [];
    }

    const lineStarts =
      this.collectLineStarts(
        content,
      );

    const boundaries:
      number[] = [0];

    for (
      const lineStart of lineStarts
    ) {
      const lineEnd =
        content.indexOf(
          "\n",
          lineStart,
        );

      const line =
        content.slice(
          lineStart,
          lineEnd === -1
            ? content.length
            : lineEnd,
        );

      if (
        lineStart > 0 &&
        (
          CHUNKING_PATTERNS
            .CODE_DECLARATION
            .test(line) ||
          CHUNKING_PATTERNS
            .CODE_NAMED_ASSIGNMENT
            .test(line)
        )
      ) {
        boundaries.push(
          lineStart,
        );
      }
    }

    return boundaries.map(
      (startOffset, index) => ({
        startOffset,
        endOffset:
          boundaries[index + 1] ??
          content.length,
        kind:
          index === 0 &&
          boundaries.length > 1
            ? "code_region"
            : "code_symbol",
      }),
    );
  }

  private fillGaps(
    symbolSpans: readonly RawChunkSpan[],
    contentLength: number,
  ): RawChunkSpan[] {
    const result:
      RawChunkSpan[] = [];

    let cursor = 0;

    for (
      const span of symbolSpans
    ) {
      if (
        span.startOffset > cursor
      ) {
        result.push({
          startOffset: cursor,
          endOffset:
            span.startOffset,
          kind: "code_region",
        });
      }

      result.push(span);

      cursor = Math.max(
        cursor,
        span.endOffset,
      );
    }

    if (cursor < contentLength) {
      result.push({
        startOffset: cursor,
        endOffset:
          contentLength,
        kind: "code_region",
      });
    }

    return result;
  }

  private removeOverlappingSymbols(
    symbols: readonly RangedSymbol[],
  ): RangedSymbol[] {
    const result: RangedSymbol[] = [];
    let lastEnd = -1;

    for (const symbol of symbols) {
      if (symbol.startOffset < lastEnd) {
        continue;
      }

      result.push(symbol);
      lastEnd = symbol.endOffset;
    }

    return result;
  }

  private sortByRange(
    symbols: readonly RangedSymbol[],
  ): RangedSymbol[] {
    return [...symbols].sort(
      (left, right) =>
        left.startOffset - right.startOffset ||
        right.endOffset - left.endOffset ||
        left.symbol.localId.localeCompare(
          right.symbol.localId,
        ),
    );
  }

  private sortSpans(
    spans: readonly RawChunkSpan[],
  ): RawChunkSpan[] {
    return [...spans].sort(
      (left, right) =>
        left.startOffset - right.startOffset ||
        right.endOffset - left.endOffset ||
        left.kind.localeCompare(right.kind) ||
        (left.symbolLocalId ?? "").localeCompare(
          right.symbolLocalId ?? "",
        ),
    );
  }

  private collectLineStarts(
    content: string,
  ): number[] {
    const starts = [0];

    for (
      let index = 0;
      index < content.length;
      index += 1
    ) {
      if (
        content[index] ===
          "\n" &&
        index + 1 <
          content.length
      ) {
        starts.push(index + 1);
      }
    }

    return starts;
  }

  private extensionOf(
    relativePath: string,
  ): string {
    const normalized =
      relativePath
        .replace(/\\/g, "/")
        .toLowerCase();

    const basename =
      normalized.split("/")
        .pop() ?? normalized;

    const dot =
      basename.lastIndexOf(".");

    return dot >= 0
      ? basename.slice(dot)
      : "";
  }
}
