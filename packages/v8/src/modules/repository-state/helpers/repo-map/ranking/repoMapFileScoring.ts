import {
  REPO_MAP_DEFAULTS,
  REPO_MAP_PATTERNS,
  REPO_MAP_REASON_ORDER,
  REPO_MAP_SCORE_WEIGHTS,
} from "../constants";

import {
  isImportantRepoMapFile,
} from "../importantFiles";

import type {
  RepoMapEntry,
  RepoMapFile,
  RepoMapFileSelection,
  RepoMapRankingContext,
  RepoMapScoreReason,
  RepoMapScoreReasonType,
  RepoMapSymbol,
} from "../types";

import {
  normalizePath,
} from "./repoMapRankingHelpers";

export interface ScoreFileInput {
  file: RepoMapFile;
  symbols: readonly RepoMapSymbol[];
  queryTerms: readonly string[];
  context: RepoMapRankingContext;
  pageRank: number;
  inboundImportCount: number;
  outboundImportCount: number;
  inboundReferenceCount: number;
  outboundReferenceCount: number;
}

export function scoreFile(
  input: ScoreFileInput,
): RepoMapEntry {
  const reasons: RepoMapScoreReason[] = [];

  let score = 0;

  score += addSelectionSignal(
    reasons,
    input.file,
    input.context.currentFile,
    "current_file",
    REPO_MAP_SCORE_WEIGHTS
      .CURRENT_FILE,
  );

  if (
    isImportantRepoMapFile(
      input.file.relativePath,
    )
  ) {
    score +=
      REPO_MAP_SCORE_WEIGHTS
        .IMPORTANT_FILE;
    reasons.push({
      type: "important_file",
      score:
        REPO_MAP_SCORE_WEIGHTS
          .IMPORTANT_FILE,
      evidence:
        `"${input.file.relativePath}" matched an important project root file.`,
    });
  }

  score += addSelectionListSignal(
    reasons,
    input.file,
    input.context.openFiles,
    "open_file",
    REPO_MAP_SCORE_WEIGHTS
      .OPEN_FILE,
  );

  score += addSelectionListSignal(
    reasons,
    input.file,
    input.context.gitDiffFiles,
    "git_diff",
    REPO_MAP_SCORE_WEIGHTS
      .GIT_DIFF_FILE,
  );

  score += addSelectionListSignal(
    reasons,
    input.file,
    input.context.diagnosticFiles,
    "diagnostic",
    REPO_MAP_SCORE_WEIGHTS
      .DIAGNOSTIC_FILE,
  );

  score += addSelectionListSignal(
    reasons,
    input.file,
    input.context.recentEditFiles,
    "recent_edit",
    REPO_MAP_SCORE_WEIGHTS
      .RECENT_EDIT_FILE,
  );

  const normalizedPath =
    input.file.relativePath.toLowerCase();
  const normalizedQuery =
    input.context.query?.toLowerCase() ?? "";

  if (
    normalizedQuery.includes(
      normalizedPath,
    )
  ) {
    score +=
      REPO_MAP_SCORE_WEIGHTS
        .QUERY_EXACT_PATH_MATCH;

    reasons.push({
      type: "query_path",
      score:
        REPO_MAP_SCORE_WEIGHTS
          .QUERY_EXACT_PATH_MATCH,
      evidence:
        `Path "${input.file.relativePath}" was explicitly mentioned in the query.`,
    });
  }

  for (const term of input.queryTerms) {
    if (normalizedPath.includes(term)) {
      score +=
        REPO_MAP_SCORE_WEIGHTS
          .QUERY_PATH_MATCH;

      reasons.push({
        type: "query_path",
        score:
          REPO_MAP_SCORE_WEIGHTS
            .QUERY_PATH_MATCH,
        evidence:
          `Path matched query term "${term}".`,
      });
    }

    for (const symbol of input.symbols) {
      const normalizedName =
        symbol.name.toLowerCase();

      if (normalizedName === term) {
        score +=
          REPO_MAP_SCORE_WEIGHTS
            .QUERY_SYMBOL_EXACT_MATCH;

        reasons.push({
          type: "query_symbol",
          score:
            REPO_MAP_SCORE_WEIGHTS
              .QUERY_SYMBOL_EXACT_MATCH,
          evidence:
            `Symbol "${symbol.name}" exactly matched query term "${term}".`,
        });

        continue;
      }

      if (normalizedName.includes(term)) {
        score +=
          REPO_MAP_SCORE_WEIGHTS
            .QUERY_SYMBOL_PARTIAL_MATCH;

        reasons.push({
          type: "query_symbol",
          score:
            REPO_MAP_SCORE_WEIGHTS
              .QUERY_SYMBOL_PARTIAL_MATCH,
          evidence:
            `Symbol "${symbol.name}" partially matched query term "${term}".`,
        });
      }
    }
  }

  score += addCountSignal(
    reasons,
    "inbound_import",
    input.inboundImportCount,
    REPO_MAP_SCORE_WEIGHTS
      .MAXIMUM_INBOUND_IMPORT_COUNT,
    REPO_MAP_SCORE_WEIGHTS
      .INBOUND_IMPORT_MULTIPLIER,
    "inbound imports",
  );

  score += addCountSignal(
    reasons,
    "outbound_import",
    input.outboundImportCount,
    REPO_MAP_SCORE_WEIGHTS
      .MAXIMUM_OUTBOUND_IMPORT_COUNT,
    REPO_MAP_SCORE_WEIGHTS
      .OUTBOUND_IMPORT_MULTIPLIER,
    "outbound imports",
  );

  score += addCountSignal(
    reasons,
    "inbound_reference",
    input.inboundReferenceCount,
    REPO_MAP_SCORE_WEIGHTS
      .MAXIMUM_INBOUND_REFERENCE_COUNT,
    REPO_MAP_SCORE_WEIGHTS
      .INBOUND_REFERENCE_MULTIPLIER,
    "inbound references",
  );

  score += addCountSignal(
    reasons,
    "outbound_reference",
    input.outboundReferenceCount,
    REPO_MAP_SCORE_WEIGHTS
      .MAXIMUM_OUTBOUND_REFERENCE_COUNT,
    REPO_MAP_SCORE_WEIGHTS
      .OUTBOUND_REFERENCE_MULTIPLIER,
    "outbound references",
  );

  const pageRankScore =
    input.pageRank *
    REPO_MAP_SCORE_WEIGHTS
      .PAGE_RANK_MULTIPLIER;

  if (pageRankScore > 0) {
    score += pageRankScore;

    reasons.push({
      type: "page_rank",
      score: pageRankScore,
      evidence:
        `File graph PageRank is ${input.pageRank.toFixed(
          REPO_MAP_DEFAULTS
            .PAGE_RANK_EVIDENCE_DECIMAL_PLACES,
        )}.`,
    });
  }

  const basename =
    input.file.relativePath
      .split("/")
      .pop() ?? "";

  if (
    REPO_MAP_PATTERNS
      .ENTRY_POINT.test(basename)
  ) {
    score +=
      REPO_MAP_SCORE_WEIGHTS
        .ENTRY_POINT;

    reasons.push({
      type: "entry_point",
      score:
        REPO_MAP_SCORE_WEIGHTS
          .ENTRY_POINT,
      evidence:
        `"${basename}" matches a conventional entry-point filename.`,
    });
  }

  reasons.sort(
    (left, right) =>
      REPO_MAP_REASON_ORDER[
        left.type
      ] -
        REPO_MAP_REASON_ORDER[
          right.type
        ] ||
      left.evidence.localeCompare(
        right.evidence,
      ),
  );

  return {
    file: input.file,
    symbols: [...input.symbols],
    score,
    pageRank: input.pageRank,
    inboundImportCount:
      input.inboundImportCount,
    outboundImportCount:
      input.outboundImportCount,
    inboundReferenceCount:
      input.inboundReferenceCount,
    outboundReferenceCount:
      input.outboundReferenceCount,
    reasons,
  };
}

export function addSelectionSignal(
  reasons: RepoMapScoreReason[],
  file: RepoMapFile,
  selection:
    RepoMapFileSelection | undefined,
  type: RepoMapScoreReasonType,
  weight: number,
): number {
  if (!matchesSelection(file, selection)) {
    return 0;
  }

  reasons.push({
    type,
    score: weight,
    evidence:
      `"${file.relativePath}" matched ${type}.`,
  });

  return weight;
}

export function addSelectionListSignal(
  reasons: RepoMapScoreReason[],
  file: RepoMapFile,
  selections:
    readonly RepoMapFileSelection[] |
    undefined,
  type: RepoMapScoreReasonType,
  weight: number,
): number {
  if (
    !matchesAnySelection(file, selections)
  ) {
    return 0;
  }

  reasons.push({
    type,
    score: weight,
    evidence:
      `"${file.relativePath}" matched ${type}.`,
  });

  return weight;
}

export function addCountSignal(
  reasons: RepoMapScoreReason[],
  type: RepoMapScoreReasonType,
  count: number,
  maximumCount: number,
  multiplier: number,
  label: string,
): number {
  const score =
    Math.min(count, maximumCount) *
    multiplier;

  if (score <= 0) {
    return 0;
  }

  reasons.push({
    type,
    score,
    evidence:
      `The file has ${count} ${label}.`,
  });

  return score;
}

export function matchesAnySelection(
  file: RepoMapFile,
  selections:
    readonly RepoMapFileSelection[] |
    undefined,
): boolean {
  return (
    selections?.some((selection) =>
      matchesSelection(file, selection),
    ) ?? false
  );
}

export function matchesSelection(
  file: RepoMapFile,
  selection:
    RepoMapFileSelection | undefined,
): boolean {
  if (!selection) {
    return false;
  }

  if (typeof selection === "string") {
    return (
      normalizePath(selection) ===
      file.relativePath
    );
  }

  return (
    normalizePath(
      selection.relativePath,
    ) === file.relativePath &&
    (!selection.rootId ||
      selection.rootId === file.rootId)
  );
}

export function tokenize(
  query: string | undefined,
): string[] {
  if (!query?.trim()) {
    return [];
  }

  return [
    ...new Set(
      (
        query.toLowerCase().match(
          REPO_MAP_PATTERNS
            .QUERY_TERM,
        ) ?? []
      ).filter(
        (term) =>
          term.length >=
          REPO_MAP_DEFAULTS
            .MINIMUM_QUERY_TERM_LENGTH,
      ),
    ),
  ];
}
