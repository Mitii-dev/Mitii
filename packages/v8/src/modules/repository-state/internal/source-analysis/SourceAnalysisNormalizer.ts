import {
  SOURCE_ANALYSIS_DEFAULTS,
  SOURCE_ANALYSIS_SCHEMA_VERSION,
} from "./constants";

import type {
  SourceAnalysis,
  SourceAnalysisImport,
  SourceAnalysisNormalizationInput,
  SourceAnalysisReference,
  SourceAnalysisSymbol,
  SourceAnalysisWarning,
} from "./types";

export class SourceAnalysisNormalizer {
  public normalize(
    input:
      SourceAnalysisNormalizationInput,
  ): SourceAnalysis {
    const warnings = [
      ...input.precedingWarnings,
      ...input.parserResult.warnings,
    ];

    const symbols =
      this.normalizeSymbols(
        input.parserResult.symbols,
        warnings,
      );

    const imports =
      this.normalizeImports(
        input.parserResult.imports,
        warnings,
      );

    const references =
      this.normalizeReferences(
        input.parserResult.references,
        warnings,
      );

    const status =
      input.parserResult.status ===
        "partial" ||
      warnings.length > 0
        ? "partial"
        : "complete";

    return {
      schemaVersion:
        SOURCE_ANALYSIS_SCHEMA_VERSION,
      sourceId: input.sourceId,
      rootId: input.rootId,
      relativePath:
        input.relativePath,
      language: input.language,
      languageSource:
        input.languageSource,
      parserId:
        input.parserResult
          .parserId,
      quality:
        input.parserResult
          .quality,
      status,
      symbols,
      imports,
      references,
      warnings:
        this.sortWarnings(
          warnings,
        ),
    };
  }

  private normalizeSymbols(
    values:
      readonly SourceAnalysisSymbol[],
    warnings:
      SourceAnalysisWarning[],
  ): SourceAnalysisSymbol[] {
    const deduplicated:
      SourceAnalysisSymbol[] = [];

    const seen =
      new Set<string>();

    let duplicates = 0;

    for (const value of values) {
      const normalized:
        SourceAnalysisSymbol = {
        ...value,
        name: value.name.trim(),
        kind: value.kind.trim(),

        ...(value.signature
          ? {
              signature:
                value.signature
                  .replace(
                    /\s+/g,
                    " ",
                  )
                  .trim()
                  .slice(
                    0,
                    SOURCE_ANALYSIS_DEFAULTS
                      .MAXIMUM_SIGNATURE_CHARACTERS,
                  ),
            }
          : {}),
      };

      const key = [
        normalized.kind,
        normalized.name,
        normalized.startLine,
      ].join("\u0000");

      if (seen.has(key)) {
        duplicates += 1;
        continue;
      }

      seen.add(key);
      deduplicated.push(
        normalized,
      );
    }

    if (duplicates > 0) {
      warnings.push({
        code:
          "duplicate_symbol_removed",
        message:
          `Removed ${duplicates} duplicate symbol facts.`,
      });
    }

    deduplicated.sort(
      (left, right) =>
        left.startLine -
          right.startLine ||
        (left.startColumn ?? 0) -
          (right.startColumn ?? 0) ||
        left.kind.localeCompare(
          right.kind,
        ) ||
        left.name.localeCompare(
          right.name,
        ),
    );

    const truncated =
      deduplicated.slice(
        0,
        SOURCE_ANALYSIS_DEFAULTS
          .MAXIMUM_SYMBOLS,
      );

    if (
      truncated.length <
      deduplicated.length
    ) {
      warnings.push({
        code:
          "symbols_truncated",
        message:
          `Symbol limit of ${SOURCE_ANALYSIS_DEFAULTS.MAXIMUM_SYMBOLS} omitted ` +
          `${deduplicated.length - truncated.length} symbols.`,
      });
    }

    this.removeInvalidParents(
      truncated,
      warnings,
    );

    return truncated;
  }

  private normalizeImports(
    values:
      readonly SourceAnalysisImport[],
    warnings:
      SourceAnalysisWarning[],
  ): SourceAnalysisImport[] {
    const deduplicated:
      SourceAnalysisImport[] = [];

    const seen =
      new Set<string>();

    let duplicates = 0;

    for (const value of values) {
      const normalized:
        SourceAnalysisImport = {
        ...value,
        specifier:
          value.specifier.trim(),
        importedNames:
          [...new Set(
            value.importedNames
              .map((name) =>
                name.trim(),
              )
              .filter(Boolean),
          )].sort(),
      };

      const key = [
        normalized.specifier,
        normalized.kind,
        normalized.line,
      ].join("\u0000");

      if (seen.has(key)) {
        duplicates += 1;
        continue;
      }

      seen.add(key);
      deduplicated.push(
        normalized,
      );
    }

    if (duplicates > 0) {
      warnings.push({
        code:
          "duplicate_import_removed",
        message:
          `Removed ${duplicates} duplicate import facts.`,
      });
    }

    deduplicated.sort(
      (left, right) =>
        left.line - right.line ||
        (left.column ?? 0) -
          (right.column ?? 0) ||
        left.specifier.localeCompare(
          right.specifier,
        ) ||
        left.kind.localeCompare(
          right.kind,
        ),
    );

    const truncated =
      deduplicated.slice(
        0,
        SOURCE_ANALYSIS_DEFAULTS
          .MAXIMUM_IMPORTS,
      );

    if (
      truncated.length <
      deduplicated.length
    ) {
      warnings.push({
        code:
          "imports_truncated",
        message:
          `Import limit of ${SOURCE_ANALYSIS_DEFAULTS.MAXIMUM_IMPORTS} omitted ` +
          `${deduplicated.length - truncated.length} imports.`,
      });
    }

    return truncated;
  }

  private normalizeReferences(
    values:
      readonly SourceAnalysisReference[],
    warnings:
      SourceAnalysisWarning[],
  ): SourceAnalysisReference[] {
    const deduplicated:
      SourceAnalysisReference[] = [];

    const seen =
      new Set<string>();

    let duplicates = 0;

    for (const value of values) {
      const normalized:
        SourceAnalysisReference = {
        ...value,
        symbolName:
          value.symbolName.trim(),
      };

      const key = [
        normalized.symbolName,
        normalized.kind,
        normalized.line,
        normalized.column ?? 0,
      ].join("\u0000");

      if (seen.has(key)) {
        duplicates += 1;
        continue;
      }

      seen.add(key);
      deduplicated.push(
        normalized,
      );
    }

    if (duplicates > 0) {
      warnings.push({
        code:
          "duplicate_reference_removed",
        message:
          `Removed ${duplicates} duplicate reference facts.`,
      });
    }

    deduplicated.sort(
      (left, right) =>
        left.line - right.line ||
        (left.column ?? 0) -
          (right.column ?? 0) ||
        left.symbolName.localeCompare(
          right.symbolName,
        ) ||
        left.kind.localeCompare(
          right.kind,
        ),
    );

    const truncated =
      deduplicated.slice(
        0,
        SOURCE_ANALYSIS_DEFAULTS
          .MAXIMUM_REFERENCES,
      );

    if (
      truncated.length <
      deduplicated.length
    ) {
      warnings.push({
        code:
          "references_truncated",
        message:
          `Reference limit of ${SOURCE_ANALYSIS_DEFAULTS.MAXIMUM_REFERENCES} omitted ` +
          `${deduplicated.length - truncated.length} references.`,
      });
    }

    return truncated;
  }

  private removeInvalidParents(
    symbols:
      SourceAnalysisSymbol[],
    warnings:
      SourceAnalysisWarning[],
  ): void {
    const ids =
      new Set(
        symbols.map(
          (symbol) =>
            symbol.localId,
        ),
      );

    let removed = 0;

    for (const symbol of symbols) {
      if (
        symbol.parentLocalId &&
        !ids.has(
          symbol.parentLocalId,
        )
      ) {
        delete symbol.parentLocalId;
        removed += 1;
      }
    }

    if (removed > 0) {
      warnings.push({
        code:
          "invalid_parent_removed",
        message:
          `Removed ${removed} parent references whose parent symbol was not included.`,
      });
    }
  }

  private sortWarnings(
    warnings:
      readonly SourceAnalysisWarning[],
  ): SourceAnalysisWarning[] {
    return [...warnings].sort(
      (left, right) =>
        (left.line ?? 0) -
          (right.line ?? 0) ||
        left.code.localeCompare(
          right.code,
        ) ||
        (left.parserId ?? "")
          .localeCompare(
            right.parserId ?? "",
          ) ||
        left.message.localeCompare(
          right.message,
        ),
    );
  }
}

