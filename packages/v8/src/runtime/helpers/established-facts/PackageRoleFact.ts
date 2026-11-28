import type { EstablishedFact } from "./Types";

const PACKAGE_ROOT = /^(packages\/[^/]+)/i;
const TEMPLATE_HINT =
  /\b(like|from|template|reference|parity|scaffold source|modeled on)\b/i;
const TARGET_HINT =
  /\b(create|scaffold|new package|target package|destination)\b/i;

export function extractPackageRoleFact(
  toolName: string,
  argumentsValue: unknown,
  output: unknown,
  outputPreview: string | undefined,
): EstablishedFact | undefined {
  if (
    toolName !== "list_directory" &&
    toolName !== "read_file" &&
    toolName !== "file_metadata"
  ) {
    return undefined;
  }
  const path =
    argumentsValue &&
    typeof argumentsValue === "object" &&
    typeof (argumentsValue as { path?: unknown }).path === "string"
      ? String((argumentsValue as { path: string }).path)
          .trim()
          .replace(/\\/g, "/")
          .replace(/^\.\//, "")
      : "";
  const packageRoot = path.match(PACKAGE_ROOT)?.[1];
  if (!packageRoot) {
    return undefined;
  }
  const preview = `${outputPreview ?? ""} ${
    typeof output === "string" ? output : ""
  }`.slice(0, 400);
  if (TEMPLATE_HINT.test(preview) || TEMPLATE_HINT.test(path)) {
    return {
      id: `package-template:${packageRoot}`,
      content: `${packageRoot} is a read-only template/reference package for this run.`,
      kind: "package_template",
      paths: [packageRoot],
    };
  }
  if (TARGET_HINT.test(preview)) {
    return {
      id: `package-target:${packageRoot}`,
      content: `${packageRoot} is the write target package for this run.`,
      kind: "package_target",
      paths: [packageRoot],
    };
  }
  if (toolName === "list_directory" && /package\.json/i.test(preview)) {
    return {
      id: `path-summary:${packageRoot}`,
      content: `${packageRoot} package root observed (has package.json).`,
      kind: "path_summary",
      paths: [packageRoot],
    };
  }
  return undefined;
}

export function extractFactPaths(
  toolName: string,
  argumentsValue: unknown,
  locator: string,
): string[] {
  const paths: string[] = [];
  if (argumentsValue && typeof argumentsValue === "object") {
    const record = argumentsValue as Record<string, unknown>;
    if (typeof record.path === "string" && record.path.trim()) {
      paths.push(record.path.trim().replace(/\\/g, "/").replace(/^\.\//, ""));
    }
    if (Array.isArray(record.paths)) {
      for (const value of record.paths) {
        if (typeof value === "string" && value.trim()) {
          paths.push(value.trim().replace(/\\/g, "/").replace(/^\.\//, ""));
        }
      }
    }
  }
  if (paths.length === 0 && locator.includes("/")) {
    paths.push(locator.split(":")[0] ?? locator);
  }
  void toolName;
  return [...new Set(paths)].slice(0, 8);
}
