import { REPO_MAP_DEFAULTS } from "./constants";

import type { RepoMapBudget, RepoMapBudgetResult, RepoMapEntry } from "./types";

export class RepoMapBudgetApplier {
  public apply(
    entries: readonly RepoMapEntry[],
    budget: RepoMapBudget = {},
  ): RepoMapBudgetResult {
    const maximumEntries =
      budget.maximumEntries ?? REPO_MAP_DEFAULTS.MAXIMUM_ENTRIES;

    const maximumSymbolsPerEntry =
      budget.maximumSymbolsPerEntry ??
      REPO_MAP_DEFAULTS.MAXIMUM_SYMBOLS_PER_ENTRY;

    const maximumEstimatedTokens =
      budget.maximumEstimatedTokens ??
      REPO_MAP_DEFAULTS.MAXIMUM_ESTIMATED_TOKENS;

    const minimumEntries = Math.min(
      budget.minimumEntries ?? REPO_MAP_DEFAULTS.MINIMUM_ENTRIES,

      maximumEntries,
    );

    this.validateLimits({
      maximumEntries,
      maximumSymbolsPerEntry,
      maximumEstimatedTokens,
      minimumEntries,
    });

    const result: RepoMapEntry[] = [];
    let estimatedTokens = 0;

    for (const source of entries) {
      if (result.length >= maximumEntries) {
        break;
      }

      const entry: RepoMapEntry = {
        ...source,

        symbols: source.symbols.slice(0, maximumSymbolsPerEntry),
      };

      const entryTokens = this.estimateEntryTokens(entry);

      if (
        result.length >= minimumEntries &&
        estimatedTokens + entryTokens > maximumEstimatedTokens
      ) {
        break;
      }

      result.push(entry);
      estimatedTokens += entryTokens;
    }

    return {
      entries: result,
      estimatedTokens,

      truncated: result.length < entries.length,
    };
  }

  public estimateEntryTokens(entry: RepoMapEntry): number {
    let characters = entry.file.relativePath.length;

    for (const symbol of entry.symbols) {
      characters +=
        symbol.name.length +
        symbol.kind.length +
        (symbol.signature?.length ?? 0) +
        REPO_MAP_DEFAULTS.APPROXIMATE_CHARACTERS_PER_TOKEN;
    }

    return Math.max(
      1,
      Math.ceil(
        characters / REPO_MAP_DEFAULTS.APPROXIMATE_CHARACTERS_PER_TOKEN,
      ),
    );
  }

  private validateLimits(limits: {
    maximumEntries: number;
    maximumSymbolsPerEntry: number;
    maximumEstimatedTokens: number;
    minimumEntries: number;
  }): void {
    for (const [name, value] of Object.entries(limits)) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name} must be a non-negative safe integer.`);
      }
    }

    if (limits.minimumEntries > limits.maximumEntries) {
      throw new RangeError("minimumEntries cannot exceed maximumEntries.");
    }
  }
}
