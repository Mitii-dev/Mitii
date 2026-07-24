import { REPO_MAP_RENDERING } from "./constants";

import type { RepoMap, RepoMapEntry, RepoMapRendererOptions } from "./types";

export class RepoMapRenderer {
  public render(
    repoMap: RepoMap,
    options: RepoMapRendererOptions = {},
  ): string {
    const entries = options.includeEmptyFiles
      ? repoMap.entries
      : repoMap.entries.filter((entry) => entry.symbols.length > 0);

    if (entries.length === 0) {
      return REPO_MAP_RENDERING.EMPTY_MAP_TEXT;
    }

    const header = [
      `${REPO_MAP_RENDERING.HEADER_PREFIX} (${entries.length} files)`,

      ...(options.includeStatistics
        ? [
            `Available: ${repoMap.statistics.availableFiles}`,
            `Ranked: ${repoMap.statistics.rankedFiles}`,
            `Included: ${repoMap.statistics.includedFiles}`,
            `Estimated tokens: ${repoMap.statistics.estimatedTokens}`,
          ]
        : []),
    ].join("\n");

    return [
      header,

      ...entries.map((entry) => this.renderEntry(entry, options)),
    ].join("\n");
  }

  public renderEntry(
    entry: RepoMapEntry,
    options: RepoMapRendererOptions = {},
  ): string {
    const score = options.includeScores
      ? ` [score=${entry.score.toFixed(
          REPO_MAP_RENDERING.SCORE_DECIMAL_PLACES,
        )}]`
      : "";

    const symbols = entry.symbols.map((symbol) => {
      const exported = symbol.exported
        ? REPO_MAP_RENDERING.EXPORTED_MARKER
        : "";

      const signature = symbol.signature
        ? REPO_MAP_RENDERING.SIGNATURE_SEPARATOR + symbol.signature
        : "";

      return (
        `  ${symbol.kind} ` + `${symbol.name}` + `${exported}` + `${signature}`
      );
    });

    return [`${entry.file.relativePath}${score}`, ...symbols].join("\n");
  }
}
