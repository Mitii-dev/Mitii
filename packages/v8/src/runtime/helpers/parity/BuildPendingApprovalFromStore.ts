import { fingerprintToolCall } from "../../../engine/tool-runtime";
import { summarizeToolCall } from "../../helpers/tool-recovery";
import type { RuntimeRunResult } from "../../contracts/output/RuntimeRunResult";

type PendingMutationSlice = {
  toolId?: string;
  invocationId?: string;
  args?: unknown;
};

/**
 * Build the host approval bag from the turn-loop pendingMutationApproval slice
 * (and optional gate tool ids) so Desktop can show/approve the command.
 */
export function buildPendingApprovalFromStore(params: {
  pending?: PendingMutationSlice | null;
  gateToolId?: string;
  gateInvocationId?: string;
}): RuntimeRunResult["pendingApproval"] | undefined {
  const toolName =
    (typeof params.pending?.toolId === "string" && params.pending.toolId) ||
    params.gateToolId;
  const callId =
    (typeof params.pending?.invocationId === "string" &&
      params.pending.invocationId) ||
    params.gateInvocationId;
  if (!toolName || !callId) return undefined;

  const args = params.pending?.args;
  const fingerprint = fingerprintToolCall(toolName, args ?? {});
  const summary = summarizeToolCall(toolName, args)?.trim() || undefined;
  const paths = extractPathsFromArgs(args);

  return {
    approvalId: callId.startsWith("appr_") ? callId : `appr_${callId}`,
    fingerprint,
    toolName,
    callId,
    ...(paths.length > 0 ? { paths } : {}),
    ...(args !== undefined ? { arguments: args } : {}),
    ...(summary ? { summary } : {}),
  };
}

function extractPathsFromArgs(args: unknown): string[] {
  if (!args || typeof args !== "object" || Array.isArray(args)) return [];
  const record = args as Record<string, unknown>;
  const found: string[] = [];
  if (typeof record.path === "string" && record.path.trim()) {
    found.push(record.path.trim());
  }
  if (Array.isArray(record.paths)) {
    for (const item of record.paths) {
      if (typeof item === "string" && item.trim()) found.push(item.trim());
    }
  }
  if (typeof record.from === "string" && record.from.trim()) {
    found.push(record.from.trim());
  }
  if (typeof record.to === "string" && record.to.trim()) {
    found.push(record.to.trim());
  }
  return [...new Set(found)].slice(0, 32);
}
