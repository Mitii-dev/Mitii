import {
  WORKSPACE_INDEXING_PIPELINE_IDS,
  WORKSPACE_INDEXING_PIPELINE_MESSAGES,
} from "./constants";

import type {
  NormalizedWorkspaceIndexingPipelineInput,
  SelectedWorkspaceIndexingFile,
  WorkspaceIndexingFilePolicyPort,
  WorkspaceIndexingFilePolicyDecision,
  WorkspaceIndexingFileSelection,
  WorkspaceIndexingWarning,
} from "./types";

import type {
  WorkspaceFileEntry,
} from "../../internal/workspace/types";

export class WorkspaceIndexingFileSelector {
  public readonly id =
    WORKSPACE_INDEXING_PIPELINE_IDS
      .FILE_SELECTOR;

  constructor(
    private readonly policy?:
      WorkspaceIndexingFilePolicyPort,
  ) {}

  public async select(
    request:
      NormalizedWorkspaceIndexingPipelineInput,
  ): Promise<WorkspaceIndexingFileSelection> {
    const rootFilter =
      request.rootIds
        .length > 0
        ? new Set(
            request.rootIds,
          )
        : undefined;

    const pathFilter =
      request.filePaths
        .length > 0
        ? new Set(
            request.filePaths,
          )
        : undefined;

    const available =
      request.snapshot
        .entries
        .filter(
          (
            entry,
          ): entry is
            WorkspaceFileEntry =>
            entry.kind ===
              "file" &&
            (
              !rootFilter ||
              rootFilter.has(
                entry.rootId,
              )
            ) &&
            (
              !pathFilter ||
              pathFilter.has(
                entry
                  .relativePath,
              )
            ),
        )
        .sort(
          (
            left,
            right,
          ) =>
            left.rootId
              .localeCompare(
                right.rootId,
              ) ||
            left.relativePath
              .localeCompare(
                right
                  .relativePath,
              ),
        );

    const included:
      SelectedWorkspaceIndexingFile[] =
      [];
    const skipped:
      WorkspaceIndexingFileSelection[
        "skipped"
      ] = [];
    const warnings:
      WorkspaceIndexingWarning[] =
      [];

    for (
      const file of
      available
    ) {
      let decision:
        WorkspaceIndexingFilePolicyDecision = {
        included:
          true,
      };

      if (
        this.policy
      ) {
        try {
          decision =
            await this.policy
              .evaluate(
                file,
              );
        } catch (
          error
        ) {
          decision = {
            included:
              false,
            reason:
              "The workspace indexing file policy failed.",
          };

          warnings.push({
            stage:
              "selection",
            code:
              "file_policy_failed",
            message:
              `File policy failed; the file was excluded safely: ${this.errorMessage(error)}`,
            rootId:
              file.rootId,
            relativePath:
              file
                .relativePath,
          });
        }
      }

      if (
        !decision.included
      ) {
        skipped.push({
          rootId:
            file.rootId,
          relativePath:
            file.relativePath,
          reason:
            decision.reason ??
            "Excluded by the workspace indexing file policy.",
        });

        continue;
      }

      included.push({
        file,
        sourceId:
          this.buildSourceId(
            file,
          ),
        ...(
          decision.language
            ? {
                language:
                  decision
                    .language,
              }
            : {}
        ),
      });
    }

    const truncated =
      included.length >
      request.maximumFiles;

    const selected =
      included.slice(
        0,
        request
          .maximumFiles,
      );

    if (
      truncated
    ) {
      warnings.push({
        stage:
          "selection",
        code:
          "file_limit_reached",
        message:
          WORKSPACE_INDEXING_PIPELINE_MESSAGES
            .FILE_LIMIT_REACHED,
      });
    }

    const retained =
      new Map<
        string,
        string[]
      >();

    for (
      const item of
      selected
    ) {
      const paths =
        retained.get(
          item.file
            .rootId,
        ) ??
        [];

      paths.push(
        item.file
          .relativePath,
      );
      retained.set(
        item.file
          .rootId,
        paths,
      );
    }

    return {
      availableFiles:
        available.length,
      selected,
      skipped,
      truncated,
      warnings,
      retainedRelativePathsByRoot:
        retained,
    };
  }

  private buildSourceId(
    file:
      WorkspaceFileEntry,
  ): string {
    return [
      "source",
      encodeURIComponent(
        file.rootId,
      ),
      encodeURIComponent(
        file.relativePath,
      ),
    ].join(
      ":",
    );
  }

  private errorMessage(
    error:
      unknown,
  ): string {
    return error
      instanceof Error
      ? error.message
      : String(
          error,
        );
  }
}
