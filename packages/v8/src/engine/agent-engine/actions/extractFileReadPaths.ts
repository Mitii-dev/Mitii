const FILE_READ_TOOLS = new Set(["read_file", "read_many_files"]);

/**
 * Paths touched by a file-read tool call. Used for exploration-efficiency
 * metrics (call count vs unique paths). Mutation and search tools are
 * intentionally excluded so edit/verify loops do not inflate the ratio.
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
    return [record.path];
  }
  if (Array.isArray(record.paths)) {
    return record.paths.filter(
      (path): path is string =>
        typeof path === "string" && path.trim().length > 0,
    );
  }
  return [];
}
