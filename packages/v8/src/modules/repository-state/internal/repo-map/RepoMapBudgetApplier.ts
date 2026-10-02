import {
  REPO_MAP_DEFAULTS,
  resolveRepoMapBudget,
} from "./constants";

import type {
  RepoMapBudget,
  RepoMapBudgetResult,
  RepoMapEntry,
} from "./types";

/**
 * Packs ranked RepoMap entries under entry/symbol/token budgets.
 * Uses binary search over the ranked prefix (aider-style) so the densest
 * high-score window that still fits the token budget is selected.
 */
export class RepoMapBudgetApplier {
  public apply(
    entries: readonly RepoMapEntry[],
    budget: RepoMapBudget = {},
  ): RepoMapBudgetResult {
    const resolved =
      resolveRepoMapBudget(budget);

    this.validateBudget(resolved);

    if (entries.length === 0) {
      return {
        entries: [],
        estimatedTokens: 0,
        truncated: false,
      };
    }

    const prepared = entries.map((entry) =>
      this.limitSymbols(
        entry,
        resolved.maximumSymbolsPerEntry,
      ),
    );

    const maxByEntries = Math.min(
      prepared.length,
      resolved.maximumEntries,
    );

    let low = Math.min(
      resolved.minimumEntries,
      maxByEntries,
    );
    let high = maxByEntries;
    let bestCount = Math.min(
      resolved.minimumEntries,
      maxByEntries,
    );

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const tokens = this.estimatePrefixTokens(
        prepared,
        mid,
      );
      if (tokens <= resolved.maximumEstimatedTokens) {
        bestCount = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    // Always keep at least minimumEntries when entries exist, even if over
    // budget — matches prior fail-open behavior for tiny maps.
    bestCount = Math.max(
      bestCount,
      Math.min(resolved.minimumEntries, maxByEntries),
    );
    bestCount = Math.min(bestCount, maxByEntries);

    const included = prepared
      .slice(0, bestCount)
      .map((entry) => ({
        ...entry,
        symbols: [...entry.symbols],
        reasons: [...entry.reasons],
      }));

    const estimatedTokens =
      this.estimatePrefixTokens(included, included.length);

    const truncated =
      included.length < entries.length ||
      prepared.some(
        (entry, index) =>
          index < included.length &&
          entry.symbols.length < entries[index]!.symbols.length,
      );

    return {
      entries: included,
      estimatedTokens,
      truncated,
    };
  }

  private limitSymbols(
    entry: RepoMapEntry,
    maximumSymbols: number,
  ): RepoMapEntry {
    if (
      entry.symbols.length <=
      maximumSymbols
    ) {
      return {
        ...entry,
        symbols: [...entry.symbols],
        reasons: [...entry.reasons],
      };
    }

    return {
      ...entry,
      symbols: entry.symbols.slice(
        0,
        maximumSymbols,
      ),
      reasons: [...entry.reasons],
    };
  }

  private estimatePrefixTokens(
    entries: readonly RepoMapEntry[],
    count: number,
  ): number {
    let total = 0;
    for (let index = 0; index < count; index += 1) {
      total += this.estimateEntryTokens(entries[index]!);
    }
    return total;
  }

  private estimateEntryTokens(
    entry: RepoMapEntry,
  ): number {
    let characters =
      entry.file.relativePath.length +
      1;

    for (const symbol of entry.symbols) {
      characters +=
        symbol.name.length +
        symbol.kind.length +
        (symbol.signature?.length ?? 0) +
        REPO_MAP_DEFAULTS
          .ESTIMATED_SYMBOL_OVERHEAD_CHARACTERS;
    }

    return Math.max(
      1,
      Math.ceil(
        characters /
          REPO_MAP_DEFAULTS
            .ESTIMATED_CHARACTERS_PER_TOKEN,
      ),
    );
  }

  private validateBudget(
    budget: Required<RepoMapBudget>,
  ): void {
    this.validatePositiveInteger(
      "maximumEntries",
      budget.maximumEntries,
    );

    this.validateNonNegativeInteger(
      "maximumSymbolsPerEntry",
      budget.maximumSymbolsPerEntry,
    );

    this.validatePositiveInteger(
      "maximumEstimatedTokens",
      budget.maximumEstimatedTokens,
    );

    this.validateNonNegativeInteger(
      "minimumEntries",
      budget.minimumEntries,
    );

    if (
      budget.minimumEntries >
      budget.maximumEntries
    ) {
      throw new RangeError(
        "minimumEntries cannot exceed maximumEntries.",
      );
    }
  }

  private validatePositiveInteger(
    name: string,
    value: number,
  ): void {
    if (
      !Number.isSafeInteger(value) ||
      value <= 0
    ) {
      throw new RangeError(
        `${name} must be a positive safe integer.`,
      );
    }
  }

  private validateNonNegativeInteger(
    name: string,
    value: number,
  ): void {
    if (
      !Number.isSafeInteger(value) ||
      value < 0
    ) {
      throw new RangeError(
        `${name} must be a non-negative safe integer.`,
      );
    }
  }
}
