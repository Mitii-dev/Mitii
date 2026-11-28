/**
 * Adapter: MemoryPipeline.commit → RuntimeMemoryCommitPort (S11-MEM).
 */

import {
  MEMORY_SCHEMA_VERSION,
  type MemoryPipeline,
  type MemoryScope,
} from "../../../modules/memory";
import type { RuntimeMemoryCommitPort } from "../../ports/RuntimeMemoryCommitPort";

export interface CreateMemoryPipelineCommitOptions {
  pipeline: MemoryPipeline;
  /** Default workspace scope when callers omit ids. */
  defaultWorkspaceId?: string;
}

export function createMemoryPipelineCommit(
  options: CreateMemoryPipelineCommitOptions,
): RuntimeMemoryCommitPort {
  return {
    async commit(input) {
      const scope: MemoryScope = input.projectId
        ? { kind: "project", projectId: input.projectId }
        : {
            kind: "workspace",
            workspaceId:
              input.workspaceId?.trim() ||
              options.defaultWorkspaceId ||
              "runtime",
          };

      try {
        const result = await options.pipeline.commit({
          schemaVersion: MEMORY_SCHEMA_VERSION,
          content: input.content,
          scope,
          tags: [...(input.tags ?? ["runtime_finish"])],
          files: [...(input.files ?? [])],
          title: input.title,
          source: "runtime",
          type: "fact",
          privacy: "private",
          importance: 6,
        });
        return {
          ok: result.status === "committed",
          memoryId: result.memoryId,
          reasonCodes: [
            result.status === "committed"
              ? "memory_pipeline_committed"
              : `memory_pipeline_commit_${result.status}`,
            ...result.reasonCodes.map(String),
          ],
        };
      } catch (error) {
        return {
          ok: false,
          reasonCodes: [
            "memory_pipeline_commit_failed",
            error instanceof Error ? error.message.slice(0, 80) : "unknown",
          ],
        };
      }
    },
  };
}
