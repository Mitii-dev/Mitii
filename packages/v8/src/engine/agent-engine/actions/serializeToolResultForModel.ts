import type { ToolResult } from "../../tool-runtime";

import { DEFAULT_TOOL_RESULT_PREVIEW_CHARS } from "../defaults";

/**
 * Serialize a tool result for the model without dumping secrets.
 * Prefer truncated redacted previews from Tool Runtime audit/output.
 */
export function serializeToolResultForModel(
  result: ToolResult,
  maxChars: number = DEFAULT_TOOL_RESULT_PREVIEW_CHARS,
): string {
  const payload: Record<string, unknown> = {
    status: result.status,
    toolName: result.toolName,
    callId: result.callId,
  };

  if (result.reasonCode) {
    payload.reasonCode = result.reasonCode;
  }
  if (result.warnings.length > 0) {
    payload.warnings = result.warnings;
  }
  if (result.truncated) {
    payload.truncated = true;
  }
  if (result.redacted) {
    payload.redacted = true;
  }

  if (result.output !== undefined) {
    payload.output = result.output;
  } else if (result.audit.outputPreview) {
    payload.outputPreview = result.audit.outputPreview;
  }

  let text = JSON.stringify(payload);
  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars)}\n…[truncated]`;
  }
  return text;
}
