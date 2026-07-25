import {
  REPO_MAP_RENDERING,
  resolveRepoMapRendererOptions,
} from "./constants";

import type {
  RepoMap,
  RepoMapEntry,
  RepoMapRendererOptions,
  RepoMapSymbol,
} from "./types";

export class RepoMapRenderer {
  public render(
    repoMap: RepoMap,
    options:
      RepoMapRendererOptions = {},
  ): string {
    const resolved =
      resolveRepoMapRendererOptions(
        options,
      );

    const sections: string[] = [];

    for (const entry of repoMap.entries) {
      if (
        !resolved.includeEmptyFiles &&
        entry.symbols.length === 0
      ) {
        continue;
      }

      sections.push(
        this.renderEntry(
          entry,
          resolved.includeScores,
        ),
      );
    }

    if (
      resolved.includeStatistics
    ) {
      sections.push(
        this.renderStatistics(
          repoMap,
        ),
      );
    }

    return sections.join(
      REPO_MAP_RENDERING
        .SECTION_SEPARATOR,
    );
  }

  private renderEntry(
    entry: RepoMapEntry,
    includeScores: boolean,
  ): string {
    const score =
      includeScores
        ? ` (score ${entry.score.toFixed(
            REPO_MAP_RENDERING
              .SCORE_DECIMAL_PLACES,
          )})`
        : "";

    const lines = [
      `${REPO_MAP_RENDERING.FILE_PREFIX}${entry.file.relativePath}${score}`,
    ];

    if (
      entry.symbols.length === 0
    ) {
      lines.push(
        `${REPO_MAP_RENDERING.SYMBOL_PREFIX}${REPO_MAP_RENDERING.EMPTY_SYMBOL_LABEL}`,
      );
    } else {
      for (const symbol of entry.symbols) {
        lines.push(
          this.renderSymbol(symbol),
        );
      }
    }

    return lines.join(
      REPO_MAP_RENDERING
        .LINE_SEPARATOR,
    );
  }

  private renderSymbol(
    symbol: RepoMapSymbol,
  ): string {
    const line =
      symbol.startLine === undefined
        ? ""
        : `:${symbol.startLine}`;

    const signature =
      symbol.signature
        ? ` — ${symbol.signature}`
        : "";

    return (
      `${REPO_MAP_RENDERING.SYMBOL_PREFIX}` +
      `${symbol.kind} ${symbol.name}` +
      `${line}${signature}`
    );
  }

  private renderStatistics(
    repoMap: RepoMap,
  ): string {
    const statistics =
      repoMap.statistics;

    return [
      REPO_MAP_RENDERING
        .STATISTICS_HEADING,
      `- status: ${repoMap.status}`,
      `- available files: ${statistics.availableFiles}`,
      `- ranked files: ${statistics.rankedFiles}`,
      `- included files: ${statistics.includedFiles}`,
      `- included symbols: ${statistics.includedSymbols}`,
      `- estimated tokens: ${statistics.estimatedTokens}`,
    ].join(
      REPO_MAP_RENDERING
        .LINE_SEPARATOR,
    );
  }
}
