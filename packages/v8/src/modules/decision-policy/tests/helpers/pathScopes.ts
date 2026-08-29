/**
 * Test-local mirror of tool-runtime path-scope membership.
 * Kept here so decision-policy tests do not import engine internals.
 */
export function isPathWithinScopes(
  relativePath: string,
  pathScopes: readonly string[],
): boolean {
  const normalizedTarget = normalizeRelativePath(relativePath);
  for (const scope of pathScopes) {
    const normalizedScope = normalizeRelativePath(scope);
    if (normalizedScope === ".") {
      return true;
    }
    if (
      normalizedTarget === normalizedScope ||
      normalizedTarget.startsWith(`${normalizedScope}/`)
    ) {
      return true;
    }
  }
  return false;
}

function normalizeRelativePath(targetPath: string): string {
  const withoutAtMention = targetPath.replace(/^@(?=[A-Za-z0-9_.-])/, "");
  const slashNormalized = withoutAtMention.replace(/\\/g, "/");
  const normalized = slashNormalized.replace(/\/+/g, "/");
  const trimmed = normalized.replace(/^\/+/, "").replace(/\/+$/, "");
  if (trimmed === "" || trimmed === ".") {
    return ".";
  }
  // Collapse ./ segments without pulling in path.posix (keeps helper self-contained).
  const parts = trimmed.split("/").filter((part) => part !== "." && part !== "");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      if (stack.length === 0) {
        return "..";
      }
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.length === 0 ? "." : stack.join("/");
}
