import {
  REPO_MAP_DEFAULTS,
  resolveRepoMapBudget,
} from "./constants";

import type {
  RepoMapBudget,
  RepoMapBudgetResult,
  RepoMapEntry,
} from "./types";

export class RepoMapBudgetApplier {
  public apply(
    entries: readonly RepoMapEntry[],
    budget: RepoMapBudget = {},
  ): RepoMapBudgetResult {
    const resolved =
      resolveRepoMapBudget(budget);

    this.validateBudget(resolved);

    const included: RepoMapEntry[] = [];
    let estimatedTokens = 0;
    let truncated = false;

    for (const entry of entries) {
      if (
        included.length >=
        resolved.maximumEntries
      ) {
        truncated = true;
        break;
      }

      const boundedEntry =
        this.limitSymbols(
          entry,
          resolved.maximumSymbolsPerEntry,
        );

      if (
        boundedEntry.symbols.length <
        entry.symbols.length
      ) {
        truncated = true;
      }

      const entryTokens =
        this.estimateEntryTokens(
          boundedEntry,
        );

      const exceedsTokenBudget =
        estimatedTokens +
          entryTokens >
        resolved.maximumEstimatedTokens;

      if (
        exceedsTokenBudget &&
        included.length >=
          resolved.minimumEntries
      ) {
        truncated = true;
        break;
      }

      included.push(boundedEntry);
      estimatedTokens += entryTokens;
    }

    if (
      included.length <
      entries.length
    ) {
      truncated = true;
    }

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
