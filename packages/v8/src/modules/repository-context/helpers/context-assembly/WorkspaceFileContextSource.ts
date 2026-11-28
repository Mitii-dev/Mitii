import {
  CONTEXT_ASSEMBLY_DEFAULTS,
  CONTEXT_ASSEMBLY_IDS,
} from "./constants";

import type {
  ContextContentSource,
  ContextContentSourceContext,
  ContextContentSourceRequest,
  ContextContentSourceResult,
  ResolvedWorkspaceFileContextSourceOptions,
  WorkspaceFileContextSourceDependencies,
  WorkspaceFileContextSourceOptions,
} from "./types";

import type {
  WorkspaceFileEntry,
} from "../../../repository-state/index";

export class WorkspaceFileContextSource
  implements ContextContentSource
{
  public readonly id =
    CONTEXT_ASSEMBLY_IDS
      .WORKSPACE_FILE_SOURCE;

  public readonly priority =
    CONTEXT_ASSEMBLY_DEFAULTS
      .WORKSPACE_SOURCE_PRIORITY;

  private readonly options:
    ResolvedWorkspaceFileContextSourceOptions;

  public constructor(
    private readonly dependencies:
      WorkspaceFileContextSourceDependencies,
    options:
      WorkspaceFileContextSourceOptions = {},
  ) {
    this.options = {
      targetedExcerptContextLines:
        options
          .targetedExcerptContextLines ??
        CONTEXT_ASSEMBLY_DEFAULTS
          .TARGETED_EXCERPT_CONTEXT_LINES,
    };

    if (
      !Number.isSafeInteger(
        this.options
          .targetedExcerptContextLines,
      ) ||
      this.options
          .targetedExcerptContextLines <
        0
    ) {
      throw new RangeError(
        "targetedExcerptContextLines must be a non-negative safe integer.",
      );
    }
  }

  public supports(
    request:
      ContextContentSourceRequest,
  ): boolean {
    return (
      request.representation ===
        "full_file" ||
      request.representation ===
        "exact_range" ||
      request.representation ===
        "targeted_excerpt"
    );
  }

  public async load(
    request:
      ContextContentSourceRequest,
    context:
      ContextContentSourceContext,
  ): Promise<ContextContentSourceResult> {
    if (
      context.abortSignal
        ?.aborted
    ) {
      return {
        status:
          "unavailable",
        message:
          "Context loading was cancelled.",
      };
    }

    const file =
      this.resolveFile(
        request,
        context,
      );

    if (!file) {
      return {
        status:
          "not_found",
        message:
          "The selected file was not found uniquely in the workspace snapshot.",
      };
    }

    if (!file.providerPath) {
      return {
        status:
          "unavailable",
        message:
          "The selected workspace file does not expose a provider path.",
      };
    }

    const content =
      await this.dependencies
        .fileSystem
        .readText(
          file.providerPath,
          {
            encoding:
              "utf8",
            maximumBytes:
              request
                .maximumBytes,
          },
        );

    if (
      request.representation ===
        "full_file"
    ) {
      return {
        status:
          "loaded",
        content,
        representation:
          "full_file",
        startLine:
          1,
        endLine:
          this.lineCount(
            content,
          ),
        ...(file.contentHash
          ? {
              contentHash:
                file.contentHash,
            }
          : {}),
      };
    }

    const startLine =
      request.item
        .startLine;
    const endLine =
      request.item
        .endLine;

    if (
      request.representation ===
        "exact_range" &&
      (
        startLine ===
          undefined ||
        endLine ===
          undefined
      )
    ) {
      return {
        status:
          "unavailable",
        message:
          "Exact-range context requires selected start and end lines.",
      };
    }

    if (
      startLine ===
        undefined ||
      endLine ===
        undefined
    ) {
      return {
        status:
          "loaded",
        content,
        representation:
          "targeted_excerpt",
        startLine:
          1,
        endLine:
          this.lineCount(
            content,
          ),
        ...(file.contentHash
          ? {
              contentHash:
                file.contentHash,
            }
          : {}),
      };
    }

    const contextLines =
      request.representation ===
        "targeted_excerpt"
        ? this.options
            .targetedExcerptContextLines
        : 0;
    const lines =
      content.split(
        /\r?\n/,
      );
    const resolvedStart =
      Math.max(
        1,
        startLine -
          contextLines,
      );
    const resolvedEnd =
      Math.min(
        lines.length,
        endLine +
          contextLines,
      );
    const selected =
      lines
        .slice(
          resolvedStart -
            1,
          resolvedEnd,
        )
        .join("\n");

    return {
      status:
        "loaded",
      content:
        selected,
      representation:
        request
          .representation,
      startLine:
        resolvedStart,
      endLine:
        resolvedEnd,
      ...(file.contentHash
        ? {
            contentHash:
              file.contentHash,
          }
        : {}),
    };
  }

  private resolveFile(
    request:
      ContextContentSourceRequest,
    context:
      ContextContentSourceContext,
  ): WorkspaceFileEntry |
    undefined {
    const matches =
      context.snapshot
        .entries
        .filter(
          (
            entry,
          ): entry is
            WorkspaceFileEntry =>
            entry.kind ===
              "file" &&
            entry.relativePath ===
              request.item
                .relativePath &&
            (
              !request.item
                .rootId ||
              entry.rootId ===
                request.item
                  .rootId
            ),
        );

    return matches.length ===
      1
      ? matches[0]
      : undefined;
  }

  private lineCount(
    content: string,
  ): number {
    return (
      content.match(
        /\r\n?|\n/g,
      ) ??
      []
    ).length +
      1;
  }
}
