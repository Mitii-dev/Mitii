import {
  textIndexUpdateResultSchema,
} from "./schema";

import {
  throwIfTextIndexAborted,
} from "./TextIndexError";

import {
  TextIndexUpdatePlanner,
} from "./TextIndexUpdatePlanner";

import type {
  TextIndexRemovalInput,
  TextIndexUpdateResult,
  TextIndexUpdaterInput,
  TextIndexWritePort,
} from "./types";

export class TextIndexUpdater {
  constructor(
    private readonly writer:
      TextIndexWritePort,

    private readonly planner =
      new TextIndexUpdatePlanner(),
  ) {}

  public async update(
    input: TextIndexUpdaterInput,
  ): Promise<TextIndexUpdateResult> {
    throwIfTextIndexAborted(
      input.abortSignal,
      "get_document_state",
      this.writer.id,
    );

    const current =
      await this.writer
        .getDocumentState(
          input.document,
          {
            ...(input.abortSignal
              ? {
                  abortSignal:
                    input
                      .abortSignal,
                }
              : {}),
          },
        );

    const plan =
      this.planner.plan({
        desired:
          input.document,
        current,
      });

    if (plan.action === "skip") {
      return this.validate({
        status: "unchanged",
        plan,
      });
    }

    if (
      plan.action ===
      "refresh_metadata"
    ) {
      const write =
        await this.writer
          .refreshDocumentMetadata(
            input.document,
            {
              ...(input
                .abortSignal
                ? {
                    abortSignal:
                      input
                        .abortSignal,
                  }
                : {}),
            },
          );

      return this.validate({
        status:
          "metadata_refreshed",
        plan,
        write,
      });
    }

    const write =
      await this.writer
        .replaceDocument(
          input.document,
          {
            ...(input.abortSignal
              ? {
                  abortSignal:
                    input
                      .abortSignal,
                }
              : {}),
          },
        );

    return this.validate({
      status: "indexed",
      plan,
      write,
    });
  }

  public async remove(
    input: TextIndexRemovalInput,
  ): Promise<TextIndexUpdateResult> {
    throwIfTextIndexAborted(
      input.abortSignal,
      "remove_document",
      this.writer.id,
    );

    const plan =
      this.planner.plan({
        current: null,
        removed: true,
      });

    const write =
      await this.writer
        .removeDocument(
          input.locator,
          input
            .workspaceSnapshotId,
          input.changedAt,
          {
            ...(input.abortSignal
              ? {
                  abortSignal:
                    input
                      .abortSignal,
                }
              : {}),
          },
        );

    return this.validate({
      status:
        write.action ===
          "not_found"
          ? "not_found"
          : "removed",
      plan,
      write,
    });
  }

  private validate(
    result: TextIndexUpdateResult,
  ): TextIndexUpdateResult {
    return textIndexUpdateResultSchema
      .parse(result) as
      TextIndexUpdateResult;
  }
}
