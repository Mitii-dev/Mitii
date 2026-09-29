import type { ModelMessage } from "../../../modules/model-gateway";
import type { PlanArtifact } from "../../../modules/planning";
import type { AgentMode } from "../../../modules/request-intake";
import type { TaskList } from "../../../modules/task-list";

import type { ToolCallCache } from "../internal/ToolCallCache";
import type { RestorePoint } from "../contracts/output/RestorePoint";
import type { AgentEngineRuntime } from "./runtime";

/**
 * Persist a RestorePoint after a successful mutating tool.
 * No-ops when checkpoint store or live mutation snapshot is unavailable.
 */
export async function writeRestorePointAfterMutation(
  runtime: AgentEngineRuntime,
  params: {
    runId: string;
    requestId: string;
    interactionMode: AgentMode;
    mutationCheckpointId: string;
    mutationCheckpointIds: readonly string[];
    messages: readonly ModelMessage[];
    toolCache: ToolCallCache;
    changedFiles: readonly string[];
    plan?: PlanArtifact;
    taskList?: TaskList;
    completedPlanStepIds?: readonly string[];
  },
): Promise<RestorePoint | undefined> {
  const store = runtime.deps.checkpointStore;
  const tools = runtime.deps.tools;
  if (!store?.saveRestorePoint || !tools?.getMutationCheckpoint) {
    return undefined;
  }

  const live = tools.getMutationCheckpoint(params.mutationCheckpointId);
  if (!live) {
    return undefined;
  }

  const files = live.files.map((file) => {
    if (file.kind === "existing") {
      return {
        relativePath: file.relativePath,
        kind: "existing" as const,
        content: file.content ?? "",
      };
    }
    return {
      relativePath: file.relativePath,
      kind: file.kind,
    };
  });

  const restorePointId = runtime.deps.idGenerator.next("rp");
  const point: RestorePoint = {
    schemaVersion: 1,
    restorePointId,
    runId: params.runId,
    requestId: params.requestId,
    createdAt: runtime.isoNow(),
    interactionMode: params.interactionMode,
    mutationSnapshot: {
      checkpointId: live.checkpointId,
      workspaceRoot: live.workspaceRoot,
      files,
      createdAt: live.createdAt,
    },
    mutationCheckpointIds: [...params.mutationCheckpointIds],
    messages: params.messages as RestorePoint["messages"],
    toolCacheEntries: params.toolCache.entries() as RestorePoint["toolCacheEntries"],
    changedFiles: [...params.changedFiles],
    ...(params.plan ? { plan: params.plan } : {}),
    ...(params.taskList ? { taskList: params.taskList } : {}),
    ...(params.completedPlanStepIds
      ? { completedPlanStepIds: [...params.completedPlanStepIds] }
      : {}),
  };

  await store.saveRestorePoint(point);
  return point;
}
