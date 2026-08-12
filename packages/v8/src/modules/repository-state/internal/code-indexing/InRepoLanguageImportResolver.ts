import * as path from "node:path";

import {
  CODE_INDEXING_DEFAULTS,
} from "./constants";

import type {
  CodeIndexImportResolution,
  CodeIndexImportResolutionInput,
} from "./types";

/**
 * Resolves non-relative import specifiers to a single in-repo file.
 * Package-manager / stdlib modules stay unresolved. Multiple distinct
 * directories stay unresolved rather than guessing.
 */
export class InRepoLanguageImportResolver {
  public resolve(
    input: CodeIndexImportResolutionInput,
  ): CodeIndexImportResolution {
    const specifier = input.specifier.trim();
    if (!specifier) {
      return { resolution: "unresolved" };
    }

    const snapshotPaths = snapshotPathSet(input);
    const language = (input.language ?? "").toLowerCase();
    const candidates = this.candidatePaths(
      language,
      specifier,
      input.importerRelativePath,
    );

    const matches: string[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      for (const resolved of this.expandExisting(candidate, snapshotPaths)) {
        if (seen.has(resolved)) continue;
        seen.add(resolved);
        matches.push(resolved);
      }
    }

    const picked = pickRepresentative(
      matches,
      lastSpecifierSegment(specifier),
    );
    if (!picked) {
      return { resolution: "unresolved" };
    }

    return {
      resolution: "resolved",
      targetRelativePath: picked,
    };
  }

  private candidatePaths(
    language: string,
    specifier: string,
    importerRelativePath: string,
  ): string[] {
    if (language === "python") {
      return pythonCandidates(specifier, importerRelativePath);
    }
    if (language === "go") {
      return goCandidates(specifier);
    }
    if (
      language === "typescript" ||
      language === "javascript" ||
      language === "tsx"
    ) {
      return typescriptCandidates(specifier);
    }
    return genericPathCandidates(specifier);
  }

  private expandExisting(
    candidate: string,
    snapshotPaths: ReadonlySet<string>,
  ): string[] {
    const matches: string[] = [];
    if (snapshotPaths.has(candidate)) {
      matches.push(candidate);
    }

    const extension = path.posix.extname(candidate);
    if (!extension) {
      for (const candidateExtension of CODE_INDEXING_DEFAULTS.IMPORT_EXTENSIONS) {
        const withExtension = `${candidate}${candidateExtension}`;
        if (snapshotPaths.has(withExtension)) {
          matches.push(withExtension);
        }
      }
      for (const basename of CODE_INDEXING_DEFAULTS.INDEX_BASENAMES) {
        for (const candidateExtension of CODE_INDEXING_DEFAULTS.IMPORT_EXTENSIONS) {
          const indexPath = `${candidate}/${basename}${candidateExtension}`;
          if (snapshotPaths.has(indexPath)) {
            matches.push(indexPath);
          }
        }
      }
      for (const existing of snapshotPaths) {
        if (
          existing.startsWith(`${candidate}/`) &&
          !existing.slice(candidate.length + 1).includes("/")
        ) {
          matches.push(existing);
        }
      }
    }

    return matches;
  }
}

function snapshotPathSet(
  input: CodeIndexImportResolutionInput,
): Set<string> {
  return new Set(
    input.snapshot.entries
      .filter(
        (entry) =>
          entry.kind === "file" &&
          entry.rootId === input.importerRootId,
      )
      .map((entry) => normalizeRelativePath(entry.relativePath))
      .filter((value) => value.length > 0),
  );
}

function pythonCandidates(
  specifier: string,
  importerRelativePath: string,
): string[] {
  if (!/^[A-Za-z_][\w.]*$/.test(specifier)) {
    return [];
  }
  const modulePath = specifier.replace(/\./g, "/");
  const candidates = [
    modulePath,
    `${modulePath}.py`,
    `${modulePath}.pyi`,
    `${modulePath}/__init__.py`,
  ];
  const importerDirectory = path.posix.dirname(
    normalizeRelativePath(importerRelativePath),
  );
  if (importerDirectory && importerDirectory !== ".") {
    const prefixes = importerDirectory.split("/");
    for (let index = prefixes.length; index >= 0; index -= 1) {
      const prefix = prefixes.slice(0, index).join("/");
      if (!prefix) continue;
      candidates.push(`${prefix}/${modulePath}`);
      candidates.push(`${prefix}/${modulePath}.py`);
      candidates.push(`${prefix}/${modulePath}/__init__.py`);
    }
  }
  return unique(candidates);
}

function goCandidates(specifier: string): string[] {
  const normalized = specifier.replace(/\\/g, "/");
  if (!normalized.includes("/") || normalized.startsWith(".")) {
    return [];
  }
  const parts = normalized.split("/").filter(Boolean);
  const suffixes: string[] = [];
  for (let index = 0; index < parts.length - 1; index += 1) {
    suffixes.push(parts.slice(index).join("/"));
  }
  if (parts.length >= 2) {
    suffixes.push(parts.slice(-2).join("/"));
    suffixes.push(parts[parts.length - 1]!);
  }
  return unique(suffixes);
}

function typescriptCandidates(specifier: string): string[] {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("node:") ||
    specifier.startsWith("#")
  ) {
    return [];
  }
  let rest = specifier;
  if (rest.startsWith("@/")) {
    rest = rest.slice(2);
  } else if (rest.startsWith("~/")) {
    rest = rest.slice(2);
  } else if (rest.startsWith("@")) {
    const segments = rest.split("/");
    if (segments.length <= 2) {
      return [];
    }
    rest = segments.slice(2).join("/");
  } else if (!rest.includes("/")) {
    return [];
  }
  if (!rest) {
    return [];
  }
  return unique([rest, `src/${rest}`]);
}

function genericPathCandidates(specifier: string): string[] {
  if (specifier.startsWith(".") || !specifier.includes("/")) {
    return [];
  }
  return [specifier.replace(/\\/g, "/")];
}

function pickRepresentative(
  matches: readonly string[],
  lastSegment: string,
): string | undefined {
  if (matches.length === 0) {
    return undefined;
  }
  if (matches.length === 1) {
    return matches[0];
  }

  const directories = new Set(
    matches.map((match) => path.posix.dirname(match)),
  );
  if (directories.size !== 1) {
    return undefined;
  }

  const named = matches.find((match) => {
    const base = path.posix.basename(match);
    const extension = path.posix.extname(base);
    return base.slice(0, base.length - extension.length) === lastSegment;
  });
  if (named) {
    return named;
  }

  const preferred = matches.find((match) => {
    const base = path.posix.basename(match);
    return (
      base === "mod.go" ||
      base === "__init__.py" ||
      base === "index.ts" ||
      base === "index.js" ||
      base === "index.tsx"
    );
  });
  if (preferred) {
    return preferred;
  }

  return [...matches].sort((left, right) => left.localeCompare(right))[0];
}

function lastSpecifierSegment(specifier: string): string {
  const normalized = specifier.replace(/\\/g, "/").replace(/\./g, "/");
  return normalized.split("/").filter(Boolean).at(-1) ?? specifier;
}

function normalizeRelativePath(value: string): string {
  const normalized = path.posix.normalize(
    value.trim().replace(/\\/g, "/").replace(/^\.\//, ""),
  );
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/")
  ) {
    return "";
  }
  return normalized.replace(/\/+$/, "");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}
