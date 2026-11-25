import {
  SOURCE_ANALYSIS_DEFAULTS,
  SOURCE_GENERIC_IMPORT_PATTERNS,
} from "../constants";

import type {
  SourceAnalysisImport,
} from "../types";

export class GenericImportExtractor {
  public extract(
    content: string,
    abortSignal?: AbortSignal,
  ): SourceAnalysisImport[] {
    const lines =
      content.split(/\r?\n/);

    const imports:
      SourceAnalysisImport[] = [];

    const safetyLimit =
      SOURCE_ANALYSIS_DEFAULTS
        .MAXIMUM_IMPORTS *
      SOURCE_ANALYSIS_DEFAULTS
        .PARSER_SAFETY_MULTIPLIER;

    for (
      let index = 0;
      index < lines.length;
      index += 1
    ) {
      this.throwIfAborted(
        abortSignal,
      );

      if (
        imports.length >=
        safetyLimit
      ) {
        break;
      }

      const line =
        lines[index] ?? "";

      for (
        const definition of
        SOURCE_GENERIC_IMPORT_PATTERNS
      ) {
        const match =
          definition.pattern.exec(
            line,
          );

        const specifier =
          match?.[1]?.trim();

        if (!specifier) {
          continue;
        }

        imports.push({
          specifier,
          kind: definition.kind,
          importedNames:
            this.importedNamesFromLine(
              line,
            ),
          line: index + 1,
          column:
            Math.max(
              0,
              line.indexOf(
                specifier,
              ),
            ) + 1,
        });

        break;
      }
    }

    return imports;
  }

  private importedNamesFromLine(
    line: string,
  ): string[] {
    const braceStart =
      line.indexOf("{");

    const braceEnd =
      line.indexOf(
        "}",
        braceStart + 1,
      );

    if (
      braceStart >= 0 &&
      braceEnd > braceStart
    ) {
      return [
        ...new Set(
          line
            .slice(
              braceStart + 1,
              braceEnd,
            )
            .split(",")
            .map((part) =>
              part
                .trim()
                .split(/\s+as\s+/i)[0]
                ?.trim() ?? "",
            )
            .filter(Boolean),
        ),
      ].sort();
    }

    if (
      /^\s*import\s+\*/.test(line)
    ) {
      return ["*"];
    }

    return [];
  }

  private throwIfAborted(
    abortSignal?: AbortSignal,
  ): void {
    if (!abortSignal?.aborted) {
      return;
    }

    const error = new Error(
      "Import extraction was aborted.",
    );

    error.name = "AbortError";

    throw error;
  }
}

