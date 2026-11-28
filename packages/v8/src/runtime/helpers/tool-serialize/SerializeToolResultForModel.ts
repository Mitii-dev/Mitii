import {
  isChangeImpactToolOutput,
} from "../../../modules/change-impact";
import type { ToolResult } from "../../../engine/tool-runtime";
import { extractCompilerErrorQueue } from "../established-facts";
import { budgetChangeImpactOutput } from "./BudgetChangeImpactOutput";
import {
  budgetReadFileOutput,
  budgetReadManyOutput,
} from "./BudgetFileOutputs";
import {
  budgetArray,
  budgetObjectStrings,
  clipString,
} from "./BudgetJsonHelpers";

export function serializeToolResultForModel(
  result: ToolResult,
  maxChars?: number | { maxContentChars?: number },
): string {
  const maxContentChars =
    typeof maxChars === "number"
      ? Math.max(1, Math.floor(maxChars))
      : maxChars?.maxContentChars !== undefined
        ? Math.max(1, Math.floor(maxChars.maxContentChars))
        : Number.MAX_SAFE_INTEGER;
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
    const budgeted = budgetToolOutputForModel(result.output, maxContentChars);
    payload.output = budgeted.output;
    if (budgeted.truncated) {
      payload.outputTruncatedForModel = true;
    }
  } else if (result.audit.outputPreview) {
    const preview = clipString(result.audit.outputPreview, maxContentChars);
    payload.outputPreview = preview.text;
    if (preview.truncated) {
      payload.outputTruncatedForModel = true;
    }
  }

  return JSON.stringify(payload);
}

function budgetToolOutputForModel(
  output: unknown,
  maxChars: number,
): { output: unknown; truncated: boolean } {
  if (typeof output === "string") {
    const clipped = clipString(output, maxChars);
    return { output: clipped.text, truncated: clipped.truncated };
  }
  if (!output || typeof output !== "object") {
    return { output, truncated: false };
  }
  if (Array.isArray(output)) {
    return budgetArray(output, maxChars);
  }

  const record = output as Record<string, unknown>;
  const compilerQueue = extractCompilerErrorQueue(record);
  if (compilerQueue && typeof record.stdout === "string") {
    return {
      output: {
        ...record,
        stdout: clipString(compilerQueue, maxChars).text,
        compilerErrorQueue: true,
      },
      truncated: true,
    };
  }
  if (Array.isArray(record.files)) {
    return budgetReadManyOutput(record, maxChars);
  }
  if (typeof record.content === "string") {
    return budgetReadFileOutput(record, maxChars);
  }
  if (isChangeImpactToolOutput(record)) {
    return budgetChangeImpactOutput(record, maxChars);
  }

  return budgetObjectStrings(record, maxChars);
}

