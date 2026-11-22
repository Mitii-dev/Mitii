import {
  REPO_MAP_SCORE_WEIGHTS,
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
} from "./repoMapFileScoring";

import {
  collectMentionedIdents,
  pathMentionsIdent,
} from "./repoMapGraphSignals";

export function buildPersonalization(
  files: readonly RepoMapFile[],
  context: RepoMapRankingContext,
): Map<string, number> {
  const result =
    new Map<string, number>();
  const mentionedIdents =
    collectMentionedIdents(context);

  for (const file of files) {
    let weight =
      REPO_MAP_SCORE_WEIGHTS
        .PERSONALIZATION_BASE;

    if (
      matchesSelection(
        file,
        context.currentFile,
      )
    ) {
      weight +=
        REPO_MAP_SCORE_WEIGHTS
          .PERSONALIZATION_CURRENT_FILE;
    }

    if (
      matchesAnySelection(
        file,
        context.openFiles,
      )
    ) {
      weight +=
        REPO_MAP_SCORE_WEIGHTS
          .PERSONALIZATION_OPEN_FILE;
    }

    if (
      matchesAnySelection(
        file,
        context.gitDiffFiles,
      )
    ) {
      weight +=
        REPO_MAP_SCORE_WEIGHTS
          .PERSONALIZATION_GIT_DIFF_FILE;
    }

    if (
      matchesAnySelection(
        file,
        context.diagnosticFiles,
      )
    ) {
      weight +=
        REPO_MAP_SCORE_WEIGHTS
          .PERSONALIZATION_DIAGNOSTIC_FILE;
    }

    if (
      matchesAnySelection(
        file,
        context.recentEditFiles,
      )
    ) {
      weight +=
        REPO_MAP_SCORE_WEIGHTS
          .PERSONALIZATION_RECENT_EDIT_FILE;
    }

    if (
      pathMentionsIdent(
        file.relativePath,
        mentionedIdents,
      )
    ) {
      weight +=
        REPO_MAP_SCORE_WEIGHTS
          .PERSONALIZATION_MENTIONED_PATH_COMPONENT;
    }

    if (
      isImportantRepoMapFile(
        file.relativePath,
      )
    ) {
      weight +=
        REPO_MAP_SCORE_WEIGHTS
          .PERSONALIZATION_IMPORTANT_FILE;
    }

    result.set(file.id, weight);
  }

  return result;
}
