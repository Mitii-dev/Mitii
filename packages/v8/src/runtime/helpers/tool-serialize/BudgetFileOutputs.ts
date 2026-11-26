export function budgetReadFileOutput(
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

export function budgetReadManyOutput(
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

export function clipContentOnLineBoundaries(
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

