import type { ToolResult } from "../../tool-runtime";

import { extractCompilerErrorQueue } from "./extractEstablishedFact";

/**
 * Serialize a tool result for the model without dumping secrets.
 * Prefer truncated redacted previews from Tool Runtime audit/output.
 * File-body tools are clipped on line boundaries with continuation cursors.
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

  return budgetObjectStrings(record, maxChars);
}

function budgetReadFileOutput(
  record: Record<string, unknown>,
  maxChars: number,
): { output: unknown; truncated: boolean } {
  const content = record.content as string;
  if (content.length <= maxChars) {
    return {
      output: {
        ...record,
        truncated: Boolean(record.truncated),
      },
      truncated: false,
    };
  }

  const startLine =
    typeof record.startLine === "number" && record.startLine >= 1
      ? Math.floor(record.startLine)
      : 1;
  const clipped = clipContentOnLineBoundaries(content, maxChars, startLine);
  return {
    output: {
      ...record,
      content: clipped.content,
      startLine: clipped.startLine,
      endLine: clipped.endLine,
      eof: false,
      nextStartLine: clipped.nextStartLine,
      truncated: true,
      truncationReason: "model_budget",
    },
    truncated: true,
  };
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
    if (item.content.length <= perFileBudget) {
      return item;
    }
    const startLine =
      typeof item.startLine === "number" && item.startLine >= 1
        ? Math.floor(item.startLine)
        : 1;
    const clipped = clipContentOnLineBoundaries(
      item.content,
      perFileBudget,
      startLine,
    );
    truncated = true;
    return {
      ...item,
      content: clipped.content,
      startLine: clipped.startLine,
      endLine: clipped.endLine,
      eof: false,
      nextStartLine: clipped.nextStartLine,
      truncated: true,
      truncationReason: "model_budget",
    };
  });
  return {
    output: {
      ...record,
      files: nextFiles,
      truncated: Boolean(record.truncated) || truncated,
    },
    truncated,
  };
}

function clipContentOnLineBoundaries(
  content: string,
  maxChars: number,
  absoluteStartLine: number,
): {
  content: string;
  startLine: number;
  endLine: number;
  nextStartLine: number;
} {
  const lines = content.length === 0 ? [] : content.split(/\r?\n/);
  if (lines.length === 0) {
    return {
      content: "",
      startLine: absoluteStartLine,
      endLine: absoluteStartLine - 1,
      nextStartLine: absoluteStartLine,
    };
  }

  let used = 0;
  let count = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const extra = index === 0 ? line.length : line.length + 1;
    if (used + extra > maxChars) {
      break;
    }
    used += extra;
    count = index + 1;
  }

  if (count === 0) {
    const sliced = `${lines[0]!.slice(0, Math.max(1, maxChars))}\n…[truncated]`;
    return {
      content: sliced,
      startLine: absoluteStartLine,
      endLine: absoluteStartLine,
      nextStartLine: absoluteStartLine + 1,
    };
  }

  const kept = lines.slice(0, count).join("\n");
  const endLine = absoluteStartLine + count - 1;
  return {
    content: kept,
    startLine: absoluteStartLine,
    endLine,
    nextStartLine: endLine + 1,
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
