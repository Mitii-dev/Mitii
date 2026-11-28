import {
  CodeIndexUpdatePlanner,
} from "./CodeIndexUpdatePlanner";

import {
  throwIfCodeIndexWriteAborted,
} from "./CodeIndexWriteError";

import type {
  CodeIndexRemovalInput,
  CodeIndexUpdateResult,
  CodeIndexUpdaterInput,
  CodeIndexWritePort,
} from "./types";

export class CodeIndexUpdater {
  constructor(
    private readonly writer:
      CodeIndexWritePort,
    private readonly planner:
      CodeIndexUpdatePlanner =
        new CodeIndexUpdatePlanner(),
  ) {}

  public async update(
    input: CodeIndexUpdaterInput,
  ): Promise<CodeIndexUpdateResult> {
    throwIfCodeIndexWriteAborted(
      input.abortSignal,
    );

    const current =
      await this.writer.getFileState(
        input.document.file,
        {
          abortSignal:
            input.abortSignal,
        },
      );

    const plan = this.planner.plan({
      current,
      desired: {
        ...input.document.file,
        analysisStatus:
          input.document.status,
      },
    });

    switch (plan.action) {
      case "insert":
      case "replace": {
        const write =
          await this.writer
            .replaceDocument(
              input.document,
              {
                abortSignal:
                  input.abortSignal,
              },
            );

        return {
          status: "indexed",
          plan,
          write,
        };
      }

      case "refresh_metadata": {
        const write =
          await this.writer
            .refreshFileMetadata(
              input.document.file,
              input.document
                .workspaceSnapshotId,
              input.document.indexedAt,
              {
                abortSignal:
                  input.abortSignal,
              },
            );

        return {
          status:
            "metadata_refreshed",
          plan,
          write,
        };
      }

      case "skip":
        return {
          status: "unchanged",
          plan,
        };

      default:
        throw new Error(
          `Unexpected Code Index update action "${plan.action}".`,
        );
    }
  }

  public async remove(
    input: CodeIndexRemovalInput,
  ): Promise<CodeIndexUpdateResult> {
    throwIfCodeIndexWriteAborted(
      input.abortSignal,
    );

    const current =
      await this.writer.getFileState(
        input.file,
        {
          abortSignal:
            input.abortSignal,
        },
      );

    const plan = this.planner.plan({
      current,
      removed: true,
    });

    const write =
      await this.writer.removeFile(
        input.file,
        input.workspaceSnapshotId,
        input.changedAt,
        {
          abortSignal:
            input.abortSignal,
        },
      );

    return {
      status:
        write.action === "not_found"
          ? "not_found"
          : "removed",
      plan,
      write,
    };
  }
}
