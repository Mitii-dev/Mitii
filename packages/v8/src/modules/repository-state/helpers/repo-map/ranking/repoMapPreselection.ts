import {
  REPO_MAP_PRESELECTION_WEIGHTS,
} from "../constants";

import {
  isImportantRepoMapFile,
} from "../importantFiles";

import type {
  RepoMapFile,
  RepoMapRankingContext,
} from "../types";

import {
  matchesAnySelection,
  matchesSelection,
  tokenize,
} from "./repoMapFileScoring";

export function preselectFiles(
  files: readonly RepoMapFile[],
  context: RepoMapRankingContext,
  maximumFiles: number,
): RepoMapFile[] {
  const queryTerms = tokenize(
    context.query,
  );

  return [...files]
    .sort((left, right) => {
      const leftPriority =
        preselectionPriority(
          left,
          context,
          queryTerms,
        );

      const rightPriority =
        preselectionPriority(
          right,
          context,
          queryTerms,
        );

      return (
        rightPriority -
          leftPriority ||
        left.rootId.localeCompare(
          right.rootId,
        ) ||
        left.relativePath.localeCompare(
          right.relativePath,
        )
      );
    })
    .slice(0, maximumFiles);
}

export function preselectionPriority(
  file: RepoMapFile,
  context: RepoMapRankingContext,
  queryTerms: readonly string[],
): number {
  let score = 0;

  if (
    matchesSelection(
      file,
      context.currentFile,
    )
  ) {
    score +=
      REPO_MAP_PRESELECTION_WEIGHTS
        .CURRENT_FILE;
  }

  if (
    isImportantRepoMapFile(
      file.relativePath,
    )
  ) {
    score +=
      REPO_MAP_PRESELECTION_WEIGHTS
        .IMPORTANT_FILE;
  }

  if (
    matchesAnySelection(
      file,
      context.gitDiffFiles,
    )
  ) {
    score +=
      REPO_MAP_PRESELECTION_WEIGHTS
        .GIT_DIFF_FILE;
  }

  if (
    matchesAnySelection(
      file,
      context.openFiles,
    )
  ) {
    score +=
      REPO_MAP_PRESELECTION_WEIGHTS
        .OPEN_FILE;
  }

  if (
    matchesAnySelection(
      file,
      context.diagnosticFiles,
    )
  ) {
    score +=
      REPO_MAP_PRESELECTION_WEIGHTS
        .DIAGNOSTIC_FILE;
  }

  if (
    matchesAnySelection(
      file,
      context.recentEditFiles,
    )
  ) {
    score +=
      REPO_MAP_PRESELECTION_WEIGHTS
        .RECENT_EDIT_FILE;
  }

  const normalizedPath =
    file.relativePath.toLowerCase();

  score +=
    queryTerms.filter((term) =>
      normalizedPath.includes(term),
    ).length *
    REPO_MAP_PRESELECTION_WEIGHTS
      .QUERY_PATH_TERM;

  return score;
}
