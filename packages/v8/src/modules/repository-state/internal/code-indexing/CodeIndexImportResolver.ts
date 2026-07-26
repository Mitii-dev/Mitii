import * as path from "node:path";

import {
  CODE_INDEXING_DEFAULTS,
  CODE_INDEXING_PATTERNS,
} from "./constants";

import type {
  CodeIndexImportResolution,
  CodeIndexImportResolutionInput,
} from "./types";

export class CodeIndexImportResolver {
  public resolve(
    input: CodeIndexImportResolutionInput,
  ): CodeIndexImportResolution {
    const specifier = input.specifier.trim();

    if (
      !specifier ||
      !CODE_INDEXING_PATTERNS.RELATIVE_IMPORT.test(
        specifier,
      )
    ) {
      return {
        resolution: "unresolved",
      };
    }

    const importerDirectory =
      path.posix.dirname(
        this.normalizePath(
          input.importerRelativePath,
        ),
      );

    const rawCandidate =
      this.normalizePath(
        path.posix.join(
          importerDirectory === "."
            ? ""
            : importerDirectory,
          specifier,
        ),
      );

    if (!rawCandidate) {
      return {
        resolution: "unresolved",
      };
    }

    const snapshotPaths = new Set(
      input.snapshot.entries
        .filter(
          (entry) =>
            entry.kind === "file" &&
            entry.rootId ===
              input.importerRootId,
        )
        .map((entry) =>
          this.normalizePath(
            entry.relativePath,
          ),
        ),
    );

    for (
      const candidate of
      this.createCandidates(
        rawCandidate,
      )
    ) {
      if (
        snapshotPaths.has(candidate)
      ) {
        return {
          resolution: "resolved",
          targetRelativePath:
            candidate,
        };
      }
    }

    return {
      resolution: "unresolved",
      candidateRelativePath:
        rawCandidate,
    };
  }

  private createCandidates(
    candidate: string,
  ): string[] {
    const candidates =
      new Set<string>([
        candidate,
      ]);

    const extension =
      path.posix.extname(candidate);

    if (!extension) {
      for (
        const candidateExtension of
        CODE_INDEXING_DEFAULTS.IMPORT_EXTENSIONS
      ) {
        candidates.add(
          `${candidate}${candidateExtension}`,
        );
      }

      for (
        const basename of
        CODE_INDEXING_DEFAULTS.INDEX_BASENAMES
      ) {
        for (
          const candidateExtension of
          CODE_INDEXING_DEFAULTS.IMPORT_EXTENSIONS
        ) {
          candidates.add(
            `${candidate}/${basename}${candidateExtension}`,
          );
        }
      }
    }

    return [...candidates];
  }

  private normalizePath(
    value: string,
  ): string {
    const normalized =
      path.posix.normalize(
        value
          .trim()
          .replace(/\\/g, "/")
          .replace(/^\.\/+/, ""),
      );

    if (
      normalized === "." ||
      normalized === ".." ||
      normalized.startsWith("../") ||
      normalized.startsWith("/") ||
      CODE_INDEXING_PATTERNS
        .WINDOWS_ABSOLUTE_PATH
        .test(normalized)
    ) {
      return "";
    }

    return normalized.replace(
      /\/+$/,
      "",
    );
  }
}
