import { vi } from "vitest";

import type { ToolInvocationInput, ToolResult } from "../../../../engine/tool-runtime";
import { TOOL_RUNTIME_SCHEMA_VERSION } from "../../../../engine/tool-runtime";

import type { VerificationToolExecutorPort } from "../../contracts";

export function toolResult(
  partial: Partial<ToolResult> & Pick<ToolResult, "callId" | "toolName" | "status">,
): ToolResult {
  return {
    schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
    truncated: false,
    redacted: false,
    durationMs: 5,
    bytesProduced: 0,
    warnings: [],
    audit: {
      callId: partial.callId,
      toolName: partial.toolName,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      status: partial.status,
      inputPreview: "{}",
      bytesProduced: 0,
      durationMs: 5,
      truncated: false,
      redacted: false,
    },
    ...partial,
  };
}

export function createTools(
  handler: (input: ToolInvocationInput) => ToolResult | Promise<ToolResult>,
): VerificationToolExecutorPort {
  return {
    execute: vi.fn(async (input) => handler(input)),
  };
}
