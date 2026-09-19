import type { ToolGrant } from "../../../../modules/decision-policy";
import type { ApprovalSkipCategory } from "../../../../modules/decision-policy";

import type { ToolReasonCode } from "../../contracts";
import { GrantValidationError } from "../../actions/ValidateGrant";
import type { ToolDefinition } from "../ToolCatalog";
import { matchGlob } from "../GlobMatch";
import { fingerprintToolCall } from "./fingerprintToolCall";

export interface ToolApprovalToken {
  approvalId: string;
  fingerprint: string;
  decision: "approved";
}

const MCP_TOOL_PREFIX = "mcp__";

/**
 * Mutation / process tools require an approval token when grant.approvalMode
 * demands it — unless approvalSkipCategories covers the tool and the
 * mutation paths are not protected.
 */
export function assertApprovalSatisfied(params: {
  tool: ToolDefinition;
  grant: ToolGrant;
  arguments: unknown;
  approval?: ToolApprovalToken;
}): void {
  const categories = resolveApprovalCategories(params.tool);
  if (categories.length === 0) {
    return;
  }

  if (params.grant.approvalMode === "never") {
    return;
  }

  const skip = new Set(params.grant.approvalSkipCategories ?? []);
  const allSkipped = categories.every((category) => skip.has(category));
  if (allSkipped && !touchesProtectedPath(params)) {
    return;
  }

  // when_required and every_mutation both gate write / execute tools.
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

/**
 * Map a tool definition to approval-skip categories (Roo-style granularity).
 * process_execute tools use "execute" only (even if they also declare write).
 * MCP tools use "mcp" when they would otherwise require approval.
 */
export function resolveApprovalCategories(
  tool: ToolDefinition,
): ApprovalSkipCategory[] {
  if (tool.name.startsWith(MCP_TOOL_PREFIX)) {
    const needsAsk =
      tool.effects.includes("workspace_write") ||
      tool.effects.includes("git_write") ||
      tool.effects.includes("external_write") ||
      tool.effects.includes("process_execute");
    return needsAsk ? ["mcp"] : [];
  }

  if (tool.effects.includes("process_execute")) {
    return ["execute"];
  }

  const categories: ApprovalSkipCategory[] = [];
  if (
    tool.effects.includes("workspace_write") ||
    tool.effects.includes("git_write")
  ) {
    categories.push("write");
  }
  if (tool.effects.includes("external_write")) {
    categories.push("external");
  }
  if (tool.effects.includes("network_access")) {
    categories.push("network");
  }
  return categories;
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

function touchesProtectedPath(params: {
  grant: ToolGrant;
  tool: ToolDefinition;
  arguments: unknown;
}): boolean {
  const globs = params.grant.protectedPathGlobs;
  if (!globs || globs.length === 0) {
    return false;
  }
  const paths = extractMutationRelativePaths(
    params.tool.name,
    params.arguments,
  );
  if (paths.length === 0) {
    return false;
  }
  return paths.some((relativePath) =>
    globs.some(
      (pattern) =>
        matchGlob(relativePath, pattern) ||
        matchGlob(relativePath, `**/${pattern}`),
    ),
  );
}

function extractMutationRelativePaths(
  toolName: string,
  argumentsValue: unknown,
): string[] {
  if (!argumentsValue || typeof argumentsValue !== "object") {
    return [];
  }
  const args = argumentsValue as Record<string, unknown>;

  if (toolName === "apply_patch" && Array.isArray(args.patches)) {
    const paths: string[] = [];
    for (const patch of args.patches) {
      if (!patch || typeof patch !== "object") {
        continue;
      }
      const entry = patch as Record<string, unknown>;
      for (const key of ["path", "filePath", "relativePath"] as const) {
        if (typeof entry[key] === "string" && entry[key].length > 0) {
          paths.push(normalizeRel(entry[key]));
        }
      }
    }
    return paths;
  }

  for (const key of [
    "path",
    "filePath",
    "relativePath",
    "from",
    "to",
    "source",
    "destination",
  ] as const) {
    if (typeof args[key] === "string" && args[key].length > 0) {
      return [normalizeRel(args[key])];
    }
  }
  return [];
}

function normalizeRel(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}
