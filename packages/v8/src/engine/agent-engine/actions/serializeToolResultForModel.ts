import type { ToolResult } from "../../tool-runtime";

import { extractCompilerErrorQueue } from "./extractEstablishedFact";

/**
 * Serialize a tool result for the model without dumping secrets.
 * Prefer truncated redacted previews from Tool Runtime audit/output.
 */
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
        repairHint:
          "Fix every listed TypeScript error class across its files this turn (up to the mutation batch). Do not address only the first diagnostic.",
      },
      truncated: true,
    };
  }
  if (Array.isArray(record.files)) {
    return budgetReadManyOutput(record, maxChars);
  }
  if (typeof record.content === "string") {
    const clipped = clipString(record.content, maxChars);
    return {
      output: { ...record, content: clipped.text, truncated: record.truncated || clipped.truncated },
      truncated: clipped.truncated,
    };
  }

  return budgetObjectStrings(record, maxChars);
}

function budgetReadManyOutput(
  record: Record<string, unknown>,
  maxChars: number,
): { output: unknown; truncated: boolean } {
  const files = record.files as unknown[];
  const perFileBudget = Math.max(1, Math.floor(maxChars / Math.max(1, files.length)));
  let truncated = false;
  const nextFiles = files.map((file) => {
    if (!file || typeof file !== "object" || Array.isArray(file)) {
      return file;
    }
    const item = file as Record<string, unknown>;
    if (typeof item.content !== "string") {
      return item;
    }
    const clipped = clipString(item.content, perFileBudget);
    truncated = truncated || clipped.truncated;
    return {
      ...item,
      content: clipped.text,
      truncated: item.truncated || clipped.truncated,
    };
  });
  return {
    output: {
      ...record,
      files: nextFiles,
      truncated: record.truncated || truncated,
    },
    truncated,
  };
}

function budgetObjectStrings(
  record: Record<string, unknown>,
  maxChars: number,
): { output: unknown; truncated: boolean } {
  let truncated = false;
  const stringKeys = Object.keys(record).filter(
    (key) => typeof record[key] === "string",
  );
  const perStringBudget = Math.max(
    1,
    Math.floor(maxChars / Math.max(1, stringKeys.length)),
  );
  const next: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") {
      const clipped = clipString(value, perStringBudget);
      next[key] = clipped.text;
      truncated = truncated || clipped.truncated;
    } else if (Array.isArray(value)) {
      const budgeted = budgetArray(value, perStringBudget);
      next[key] = budgeted.output;
      truncated = truncated || budgeted.truncated;
    } else {
      next[key] = value;
    }
  }

  return { output: next, truncated };
}

function budgetArray(
  value: unknown[],
  maxChars: number,
): { output: unknown[]; truncated: boolean } {
  let truncated = false;
  const perItemBudget = Math.max(1, Math.floor(maxChars / Math.max(1, value.length)));
  const output = value.map((item) => {
    if (typeof item === "string") {
      const clipped = clipString(item, perItemBudget);
      truncated = truncated || clipped.truncated;
      return clipped.text;
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const budgeted = budgetObjectStrings(
        item as Record<string, unknown>,
        perItemBudget,
      );
      truncated = truncated || budgeted.truncated;
      return budgeted.output;
    }
    return item;
  });
  return { output, truncated };
}

function clipString(
  value: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (value.length <= maxChars) {
    return { text: value, truncated: false };
  }
  return {
    text: `${value.slice(0, Math.max(1, maxChars))}\n…[truncated]`,
    truncated: true,
  };
}
