export function preserveWorkspaceRootMutationScope(
  previousScopes: readonly string[],
  narrowedScopes: readonly string[],
): string[] {
  const hadWorkspaceRoot = previousScopes.some(
    (scope) => normalizeScope(scope) === ".",
  );
  if (!hadWorkspaceRoot) {
    return [...narrowedScopes];
  }
  return uniqueStrings([".", ...narrowedScopes]);
}

export function narrowPathScopes(
  previousScopes: readonly string[],
  discoveredPaths: readonly string[],
): string[] {
  const discoveredScopes = deriveDiscoveredScopes(discoveredPaths);
  if (discoveredScopes.length === 0) {
    return [...previousScopes];
  }

  const narrowed = new Set<string>();
  for (const previous of previousScopes) {
    const normalizedPrevious = normalizeScope(previous);
    for (const discovered of discoveredScopes) {
      if (scopeContains(normalizedPrevious, discovered)) {
        narrowed.add(discovered);
      } else if (scopeContains(discovered, normalizedPrevious)) {
        narrowed.add(normalizedPrevious);
      }
    }
  }

  return narrowed.size > 0
    ? [...narrowed].sort((a, b) => a.localeCompare(b))
    : [...previousScopes];
}

export function deriveDiscoveredScopes(discoveredPaths: readonly string[]): string[] {
  return uniqueStrings(
    discoveredPaths
      .map((path) => projectScopeFromPath(path) ?? parentScopeFromPath(path))
      .filter((path): path is string => Boolean(path)),
  );
}

function projectScopeFromPath(value: string): string | undefined {
  const normalized = normalizeScope(value);
  if (!isSafeRelativeScope(normalized)) {
    return undefined;
  }

  const parts = normalized.split("/");
  const workspaceContainer = parts[0];
  const projectName = parts[1];
  if (
    projectName &&
    (workspaceContainer === "packages" || workspaceContainer === "apps")
  ) {
    return `${workspaceContainer}/${projectName}`;
  }

  return undefined;
}

function parentScopeFromPath(value: string): string | undefined {
  const normalized = normalizeScope(value);
  if (!isSafeRelativeScope(normalized)) {
    return undefined;
  }
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

function isSafeRelativeScope(normalized: string): boolean {
  return (
    Boolean(normalized) &&
    !normalized.includes("..") &&
    !normalized.startsWith("/") &&
    !normalized.startsWith("~") &&
    !/^[A-Za-z]:\//.test(normalized)
  );
}

function normalizeScope(value: string): string {
  return value
    .trim()
    .replace(/^@+/, "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "") || ".";
}

function scopeContains(parent: string, child: string): boolean {
  if (parent === ".") {
    return true;
  }
  if (child === ".") {
    return parent === ".";
  }
  return child === parent || child.startsWith(`${parent}/`);
}

export function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
