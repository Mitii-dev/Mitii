import type { ModelToolCall } from "../../../modules/model-gateway";
import { isPatchTargetedDiscoveryReason } from "../../tool-runtime";
import type { ToolResult } from "../../tool-runtime";

import { AGENT_ENGINE_THRESHOLDS } from "../policy";

const TARGETED_REJECTED_MUTATION_DISCOVERY_TOOLS = new Set([
  "analyze_change_impact",
  "file_metadata",
  "glob_files",
  "list_directory",
  "read_file",
  "read_many_files",
  "search_files",
]);

export function buildRejectedMutationRecoveryMessage(params: {
  toolName: string;
  status: ToolResult["status"];
  reasonCode?: ToolResult["reasonCode"];
  warnings: readonly string[];
  summary?: string;
  maxTargetedDiscoveryToolCalls?: number;
  defaultPreferredBatchSize?: number;
}): string {
  const reason = params.reasonCode ? ` (${params.reasonCode})` : "";
  const warnings =
    params.warnings.length > 0
      ? `\nTool warning: ${params.warnings.slice(0, 3).join(" ")}`
      : "";
  const summary = params.summary ? `\nAttempt: ${params.summary}` : "";
  const allowTargetedDiscovery =
    allowsTargetedDiscoveryAfterRejectedMutation(params);

  const instructions = [
    `The mutation tool ${params.toolName} was ${params.status}${reason}.`,
    `${summary}${warnings}`,
    "Do not restart broad exploration.",
    "When the rejected result includes currentContent, copy exact oldText from that content and retry apply_patch immediately. Do not spend a turn re-reading unless currentContent is missing.",
  ];

  if (allowTargetedDiscovery) {
    const max =
      params.maxTargetedDiscoveryToolCalls ??
      params.defaultPreferredBatchSize ??
      AGENT_ENGINE_THRESHOLDS.defaultPreferredBatchSize;
    instructions.push(
      `If the rejection indicates stale oldText or a missing patch path, you may use at most ${max} targeted read/list/search call(s) for exact stale patch files or their parent directories.`,
      "After that targeted discovery, retry apply_patch/delete_file/move_file with corrected arguments, or stop with a clear blocker.",
    );
  } else {
    instructions.push(
      "Your next turn must either call apply_patch/delete_file/move_file with corrected arguments, or stop with a clear blocker. Do not read or search more files first.",
    );
  }

  return instructions.join("\n");
}

export function allowsTargetedDiscoveryAfterRejectedMutation(params: {
  toolName: string;
  reasonCode?: ToolResult["reasonCode"];
  warnings: readonly string[];
  summary?: string;
}): boolean {
  if (params.toolName !== "apply_patch") {
    return false;
  }

  const details = [
    params.reasonCode,
    params.summary,
    ...params.warnings,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (params.reasonCode === "path_out_of_scope") {
    return true;
  }
  if (isPatchTargetedDiscoveryReason(params.reasonCode)) {
    return true;
  }
  if (
    params.reasonCode === "invalid_arguments" &&
    (details.includes("analyze_change_impact") ||
      details.includes("oldtext") ||
      details.includes("old text") ||
      details.includes("not found") ||
      details.includes("does not exist") ||
      details.includes("missing"))
  ) {
    return true;
  }
  return false;
}

export function isTargetedDiscoveryAfterRejectedMutation(params: {
  recovery: {
    allowTargetedDiscovery: boolean;
    targetedDiscoveryToolCallsUsed: number;
    maxTargetedDiscoveryToolCalls: number;
  };
  toolCalls: readonly ModelToolCall[];
  successfulToolCount: number;
  rejectedToolCount: number;
}): boolean {
  if (
    !params.recovery.allowTargetedDiscovery ||
    params.toolCalls.length === 0 ||
    params.recovery.targetedDiscoveryToolCallsUsed + params.toolCalls.length >
      params.recovery.maxTargetedDiscoveryToolCalls ||
    params.successfulToolCount === 0 ||
    params.rejectedToolCount > 0
  ) {
    return false;
  }

  return params.toolCalls.every((call) =>
    TARGETED_REJECTED_MUTATION_DISCOVERY_TOOLS.has(call.name),
  );
}

export function buildRejectedToolRecoveryMessage(params: {
  toolName: string;
  status: ToolResult["status"];
  reasonCode?: ToolResult["reasonCode"];
  warnings: readonly string[];
  summary?: string;
}): string {
  const reason = params.reasonCode ? ` (${params.reasonCode})` : "";
  const summary = params.summary ? `\nAttempt: ${params.summary}` : "";
  const warnings =
    params.warnings.length > 0
      ? `\nTool warning: ${params.warnings.slice(0, 3).join(" ")}`
      : "";

  return [
    `The requested tool ${params.toolName} was ${params.status}${reason}.`,
    `${summary}${warnings}`,
    "Do not repeat rejected tool calls.",
    "If you need more context, call the read/search tool once with corrected, valid arguments. If you already have enough context, call apply_patch now.",
    "Do not end the turn with more malformed or duplicate read/search calls.",
  ].join("\n");
}
