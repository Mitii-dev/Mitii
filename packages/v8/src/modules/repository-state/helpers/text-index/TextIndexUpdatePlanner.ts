import type {
  TextIndexUpdatePlan,
  TextIndexUpdatePlannerInput,
} from "./types";

export class TextIndexUpdatePlanner {
  public plan(
    input: TextIndexUpdatePlannerInput,
  ): TextIndexUpdatePlan {
    if (input.removed) {
      return {
        action: "remove",
        reason:
          "document_removed",
      };
    }

    const desired =
      input.desired;

    if (!desired) {
      throw new TypeError(
        "desired is required unless removed is true.",
      );
    }

    if (!input.current) {
      return {
        action: "insert",
        reason:
          "document_not_indexed",
      };
    }

    if (
      input.current
        .sourceContentHash !==
      desired.sourceContentHash
    ) {
      return {
        action: "replace",
        reason:
          "source_changed",
      };
    }

    if (
      input.current
        .pipelineVersion !==
      desired.pipelineVersion
    ) {
      return {
        action: "replace",
        reason:
          "pipeline_changed",
      };
    }

    if (
      input.current
        .chunkingStatus !==
      desired.chunkingStatus
    ) {
      return {
        action: "replace",
        reason:
          "chunking_status_changed",
      };
    }

    if (
      input.current
        .chunkCount !==
      desired.chunks.length
    ) {
      return {
        action: "replace",
        reason:
          "chunk_count_changed",
      };
    }

    if (
      input.current
        .workspaceSnapshotId !==
        desired
          .workspaceSnapshotId ||
      input.current.indexedAt !==
        desired.indexedAt
    ) {
      return {
        action:
          "refresh_metadata",
        reason:
          "snapshot_changed",
      };
    }

    return {
      action: "skip",
      reason: "unchanged",
    };
  }
}

