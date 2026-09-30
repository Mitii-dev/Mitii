const FILE_READ_TOOLS = new Set(["read_file", "read_many_files"]);

/**
 * Locators touched by a file-read tool call. Used for exploration-efficiency
 * metrics (call count vs unique paths/ranges). Range-aware so continuation
 * reads (`startLine=nextStartLine`) count as new coverage, not thrash.
 */
export function extractFileReadPaths(
  toolName: string,
  argumentsValue: unknown,
): string[] | undefined {
  if (!FILE_READ_TOOLS.has(toolName)) {
    return undefined;
  }
  if (!argumentsValue || typeof argumentsValue !== "object") {
    return [];
  }
  const record = argumentsValue as Record<string, unknown>;
  if (typeof record.path === "string" && record.path.trim().length > 0) {
    return [withLineRange(record.path.trim(), record.startLine, record.endLine)];
  }
  if (Array.isArray(record.paths)) {
    return record.paths.filter(
      (path): path is string =>
        typeof path === "string" && path.trim().length > 0,
    );
  }
  return [];
}

function withLineRange(
  path: string,
  startLine: unknown,
  endLine: unknown,
): string {
  const start = typeof startLine === "number" ? startLine : undefined;
  const end = typeof endLine === "number" ? endLine : undefined;
  if (!start && !end) {
    return path;
  }
  return `${path}:${start ?? 1}${end ? `-${end}` : ""}`;
}
