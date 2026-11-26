/**
 * Best-effort path extraction from tool args for settle → TaskList (S11-TASK).
 */

export function extractChangedPathsFromToolArgs(args: unknown): string[] {
  if (!args || typeof args !== "object") return [];
  const record = args as Record<string, unknown>;
  const out: string[] = [];

  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim()) {
      out.push(value.trim());
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.trim()) out.push(item.trim());
        else if (item && typeof item === "object" && "path" in item) {
          const path = (item as { path?: unknown }).path;
          if (typeof path === "string" && path.trim()) out.push(path.trim());
        }
      }
    }
  };

  for (const key of [
    "path",
    "filePath",
    "file",
    "target",
    "paths",
    "files",
    "writePaths",
    "changedPaths",
  ]) {
    if (key in record) push(record[key]);
  }

  if ("patches" in record && Array.isArray(record.patches)) {
    for (const patch of record.patches) {
      if (patch && typeof patch === "object" && "path" in patch) {
        push((patch as { path?: unknown }).path);
      }
    }
  }

  return [...new Set(out)].slice(0, 64);
}
