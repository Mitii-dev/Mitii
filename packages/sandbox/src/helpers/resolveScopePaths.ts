import path from 'node:path';

/**
 * Strip trailing glob segments so OS backends can use concrete paths.
 * `.mitii/**` → `.mitii`, `src/*` → `src`, `.` → workspace root.
 */
export function stripScopeGlob(scope: string): string {
  let cleaned = scope.trim();
  if (!cleaned) return cleaned;
  cleaned = cleaned.replace(/\\/g, '/');
  cleaned = cleaned.replace(/\/\*\*$/, '');
  cleaned = cleaned.replace(/\/\*$/, '');
  cleaned = cleaned.replace(/\*\*$/, '');
  cleaned = cleaned.replace(/\*$/, '');
  cleaned = cleaned.replace(/\/+$/, '');
  return cleaned === '' ? '.' : cleaned;
}

/**
 * Resolve a grant/safety scope to an absolute path under workspaceRoot when
 * relative. Absolute scopes stay absolute (caller decides trust).
 */
export function resolveScopeToAbsolute(
  workspaceRoot: string,
  scope: string,
): string | undefined {
  const stripped = stripScopeGlob(scope);
  if (!stripped) return undefined;
  const root = path.resolve(workspaceRoot);
  if (stripped === '.') return root;
  if (path.isAbsolute(stripped)) {
    return path.resolve(stripped);
  }
  return path.resolve(root, stripped);
}

export function resolveScopeList(
  workspaceRoot: string,
  scopes: readonly string[] | undefined,
): string[] {
  if (!scopes || scopes.length === 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const scope of scopes) {
    const abs = resolveScopeToAbsolute(workspaceRoot, scope);
    if (!abs || seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }
  return out;
}

/** Keep only paths that equal root or sit under it. */
export function filterUnderWorkspace(
  workspaceRoot: string,
  absolutePaths: readonly string[],
): string[] {
  const root = path.resolve(workspaceRoot);
  return absolutePaths.filter((candidate) => {
    const abs = path.resolve(candidate);
    return abs === root || abs.startsWith(root + path.sep);
  });
}
