import {
  CONTEXT_ASSEMBLY_MESSAGES,
} from "./constants";

import type {
  ContextAssemblyDropCause,
  ContextAssemblyWarning,
  ContextContentLoadResult,
  DroppedContextBlock,
} from "./types";

import type {
  SelectedContextItem,
} from "../context-selection/types";

export function buildDroppedBlock(
  item: SelectedContextItem,
  cause: ContextAssemblyDropCause,
  evidence: string,
): DroppedContextBlock {
  return {
    selectionKey: item.key,
    relativePath: item.relativePath,
    priority: item.priority,
    cause,
    evidence,
  };
}

export function cancelledWarning(): ContextAssemblyWarning {
  return {
    code: "cancelled",
    message: CONTEXT_ASSEMBLY_MESSAGES.CANCELLED,
  };
}

/**
 * Records a `required_content_omitted` warning for required items.
 * Returns whether the omitted item was required.
 */
export function markRequiredOmitted(
  item: SelectedContextItem,
  warnings: ContextAssemblyWarning[],
): boolean {
  if (item.priority !== "required") {
    return false;
  }

  warnings.push({
    code: "required_content_omitted",
    message: CONTEXT_ASSEMBLY_MESSAGES.REQUIRED_CONTENT_OMITTED,
    selectionKey: item.key,
    relativePath: item.relativePath,
  });

  return true;
}

export function describeLoadFailure(
  item: SelectedContextItem,
  result: ContextContentLoadResult,
): {
  drop: DroppedContextBlock;
  warnings: ContextAssemblyWarning[];
} {
  const failedAttempts = result.attempts.filter(
    (attempt) => attempt.status === "failed",
  );

  if (result.status === "failed") {
    return {
      drop: buildDroppedBlock(
        item,
        "content_source_failed",
        CONTEXT_ASSEMBLY_MESSAGES.CONTENT_SOURCE_FAILED,
      ),
      warnings:
        failedAttempts.length > 0
          ? failedAttempts.map((attempt) => ({
              code: "content_source_failed" as const,
              message:
                `${CONTEXT_ASSEMBLY_MESSAGES.CONTENT_SOURCE_FAILED} ${attempt.message}`,
              selectionKey: item.key,
              relativePath: item.relativePath,
              sourceId: attempt.sourceId,
            }))
          : [
              {
                code: "content_source_failed" as const,
                message: CONTEXT_ASSEMBLY_MESSAGES.CONTENT_SOURCE_FAILED,
                selectionKey: item.key,
                relativePath: item.relativePath,
              },
            ],
    };
  }

  const allNotFound =
    result.attempts.length > 0 &&
    result.attempts.every((attempt) => attempt.status === "not_found");
  const cause: ContextAssemblyDropCause = allNotFound
    ? "content_not_found"
    : "content_unavailable";
  const code = allNotFound
    ? ("content_not_found" as const)
    : ("content_unavailable" as const);
  const message = allNotFound
    ? CONTEXT_ASSEMBLY_MESSAGES.CONTENT_NOT_FOUND
    : CONTEXT_ASSEMBLY_MESSAGES.CONTENT_UNAVAILABLE;

  return {
    drop: buildDroppedBlock(item, cause, message),
    warnings: [
      {
        code,
        message,
        selectionKey: item.key,
        relativePath: item.relativePath,
      },
    ],
  };
}
