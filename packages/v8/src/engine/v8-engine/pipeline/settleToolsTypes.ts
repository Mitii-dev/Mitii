import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { ToolResult } from "../../tool-runtime";
import type { ToolLoopResult } from "../modules/tool-loop-guard";
import type { ToolLoopOutcome } from "./types";

export type RejectedMutationInfo = {
  toolName: string;
  status: ToolResult["status"];
  reasonCode?: ToolResult["reasonCode"];
  warnings: readonly string[];
  summary?: string;
};

export type SettleBatchStats = {
  succeededMutating: boolean;
  /** Succeeded git_write tool (e.g. git_signoff_range) — satisfies VCS-only execute. */
  succeededGitWrite: boolean;
  readonlyOnly: boolean;
  results: ToolLoopResult[];
  /** Last failed mutating tool in this batch (if any). */
  rejectedMutation?: RejectedMutationInfo;
};

export type SettleToolsResult =
  | { kind: "continue"; decision: ExecutionDecision; stats: SettleBatchStats }
  | { kind: "return"; outcome: ToolLoopOutcome };
