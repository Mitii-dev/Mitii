import type { MutationCheckpoint } from "../../tool-runtime";

import {
  agentEngineRestoreInputSchema,
  agentEngineRestoreResultSchema,
  type AgentEngineRestoreInput,
  type AgentEngineRestoreResult,
  type RestorePoint,
} from "../contracts/output/RestorePoint";
import { AgentEngineError } from "../contracts";
import type { AgentEngineRuntime } from "./runtime";

/**
 * Restore workspace files (and return frozen conversation state) to a
 * previously saved RestorePoint. Rolls back the target point and every
 * newer restore point for the same run (newest → oldest).
 *
 * Never rewrites user `.git`. Never escalates grants — returns the
 * interactionMode frozen on the RestorePoint.
 */
export async function executeRestore(
  runtime: AgentEngineRuntime,
  input: AgentEngineRestoreInput,
): Promise<AgentEngineRestoreResult> {
  let parsed: AgentEngineRestoreInput;
  try {
    parsed = agentEngineRestoreInputSchema.parse(input);
  } catch (error) {
    throw new AgentEngineError(
      "invalid_input",
      "Agent Engine restore input failed schema validation.",
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }

  const store = runtime.deps.checkpointStore;
  if (!store?.loadRestorePoint || !store.listRestorePoints) {
    throw new AgentEngineError(
      "invalid_input",
      "Restore requires a checkpoint store that supports restore points.",
    );
  }

  const tools = runtime.deps.tools;
  if (!tools?.restoreMutationSnapshot) {
    throw new AgentEngineError(
      "invalid_input",
      "Restore requires tools.restoreMutationSnapshot.",
    );
  }

  const target = await store.loadRestorePoint(
    parsed.runId,
    parsed.restorePointId,
  );
  if (!target) {
    throw new AgentEngineError(
      "invalid_input",
      `No restore point "${parsed.restorePointId}" for run "${parsed.runId}".`,
    );
  }

  const all = await store.listRestorePoints(parsed.runId);
  const targetIndex = all.findIndex(
    (summary) => summary.restorePointId === parsed.restorePointId,
  );
  if (targetIndex < 0) {
    throw new AgentEngineError(
      "invalid_input",
      `Restore point "${parsed.restorePointId}" is not listed for run "${parsed.runId}".`,
    );
  }

  const toRollBack = all.slice(targetIndex).reverse();
  const rolledBackRestorePointIds: string[] = [];
  const restoredFiles = new Set<string>();

  for (const summary of toRollBack) {
    const point =
      summary.restorePointId === target.restorePointId
        ? target
        : await store.loadRestorePoint(parsed.runId, summary.restorePointId);
    if (!point) {
      continue;
    }
    assertWorkspaceMatch(point, parsed.workspaceRoot);
    const snapshot = toMutationCheckpoint(point);
    const paths = await tools.restoreMutationSnapshot(snapshot);
    for (const path of paths) {
      restoredFiles.add(path);
    }
    rolledBackRestorePointIds.push(point.restorePointId);
  }

  const result: AgentEngineRestoreResult = {
    schemaVersion: 1,
    runId: parsed.runId,
    restorePointId: parsed.restorePointId,
    restoredFiles: [...restoredFiles],
    rolledBackRestorePointIds,
    interactionMode: target.interactionMode,
    messages: target.messages,
    changedFiles: target.changedFiles,
    ...(target.plan ? { plan: target.plan } : {}),
    ...(target.taskList ? { taskList: target.taskList } : {}),
  };

  return agentEngineRestoreResultSchema.parse(result);
}

function assertWorkspaceMatch(
  point: RestorePoint,
  workspaceRoot: string,
): void {
  const snapshotRoot = point.mutationSnapshot.workspaceRoot.replace(/\/+$/, "");
  const requested = workspaceRoot.replace(/\/+$/, "");
  if (snapshotRoot !== requested) {
    throw new AgentEngineError(
      "invalid_input",
      `Restore workspace root mismatch: snapshot="${snapshotRoot}" requested="${requested}".`,
    );
  }
}

function toMutationCheckpoint(point: RestorePoint): MutationCheckpoint {
  return {
    checkpointId: point.mutationSnapshot.checkpointId,
    workspaceRoot: point.mutationSnapshot.workspaceRoot,
    createdAt: point.mutationSnapshot.createdAt,
    files: point.mutationSnapshot.files.map((file) => {
      if (file.kind === "existing") {
        return {
          relativePath: file.relativePath,
          kind: "existing" as const,
          content: file.content,
        };
      }
      return {
        relativePath: file.relativePath,
        kind: file.kind,
      };
    }),
  };
}
