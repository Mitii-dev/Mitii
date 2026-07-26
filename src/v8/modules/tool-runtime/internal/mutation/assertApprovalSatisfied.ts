import type { ToolGrant } from "../../../decision-policy";

import type { ToolReasonCode } from "../../contracts";
import { GrantValidationError } from "../../actions/ValidateGrant";
import type { ToolDefinition } from "../ToolCatalog";
import { fingerprintToolCall } from "./fingerprintToolCall";

export interface ToolApprovalToken {
  approvalId: string;
  fingerprint: string;
  decision: "approved";
}

/**
 * Mutation tools require an approval token when grant.approvalMode demands it.
 */
export function assertApprovalSatisfied(params: {
  tool: ToolDefinition;
  grant: ToolGrant;
  arguments: unknown;
  approval?: ToolApprovalToken;
}): void {
  const requiresApproval =
    params.tool.effects.includes("workspace_write") ||
    params.tool.effects.includes("git_write") ||
    params.tool.effects.includes("external_write");

  if (!requiresApproval) {
    return;
  }

  if (params.grant.approvalMode === "never") {
    return;
  }

  // when_required and every_mutation both gate Phase 8 write tools.
  if (!params.approval || params.approval.decision !== "approved") {
    throw new GrantValidationError(
      "approval_required",
      `Tool "${params.tool.name}" requires approval before mutation.`,
    );
  }

  const expected = fingerprintToolCall(params.tool.name, params.arguments);
  if (params.approval.fingerprint !== expected) {
    throw new GrantValidationError(
      "approval_mismatch",
      `Approval fingerprint does not match tool call for "${params.tool.name}".`,
    );
  }
}

export function approvalRequiredPayload(params: {
  toolName: string;
  arguments: unknown;
}): {
  reasonCode: ToolReasonCode;
  fingerprint: string;
} {
  return {
    reasonCode: "approval_required",
    fingerprint: fingerprintToolCall(params.toolName, params.arguments),
  };
}
