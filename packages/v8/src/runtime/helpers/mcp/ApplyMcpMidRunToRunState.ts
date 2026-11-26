/**
 * Persist mid-run MCP change onto RunState + optional light-enrich flag.
 */

import type { RunState } from "../run-state/RunState";
import {
  applyMcpMidRun,
  type ApplyMcpMidRunInput,
  type ApplyMcpMidRunResult,
} from "./ApplyMcpMidRun";

export function applyMcpMidRunToRunState(
  runState: RunState,
  input: Omit<ApplyMcpMidRunInput, "currentMcpServerIds" | "runId"> & {
    currentMcpServerIds?: readonly string[];
  },
): ApplyMcpMidRunResult {
  const current =
    input.currentMcpServerIds ??
    runState.get<string[]>("mcpServerIds") ??
    [];
  const result = applyMcpMidRun({
    runId: runState.runId,
    action: input.action,
    serverId: input.serverId,
    currentMcpServerIds: current,
    requiredForActiveTask: input.requiredForActiveTask,
    enableExtendedGates: input.enableExtendedGates,
  });
  if (result.changed) {
    runState.set("mcpServerIds", result.mcpServerIds);
  }
  return result;
}
