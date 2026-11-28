import type { MemoryFact } from "../contracts";

export function normalizeMemoryPath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^@+/, "")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

export function fileBasename(path: string): string {
  const normalized = normalizeMemoryPath(path);
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? normalized;
}

/**
 * Rank facts that mention Understanding file targets.
 * Exact path matches rank above basename matches.
 */
export function rankFactsByFileTargets(
  facts: readonly MemoryFact[],
  fileTargets: readonly string[],
): string[] {
  if (fileTargets.length === 0) {
    return [];
  }

  const targets = fileTargets
    .map(normalizeMemoryPath)
    .filter((path) => path.length > 0);
  if (targets.length === 0) {
    return [];
  }

  const exact: string[] = [];
  const basename: string[] = [];
  const seen = new Set<string>();

  for (const fact of facts) {
    if (fact.files.length === 0) {
      continue;
    }
    const files = fact.files.map(normalizeMemoryPath);
    const exactHit = files.some((file) =>
      targets.some((target) => file === target || file.endsWith(`/${target}`)),
    );
    const baseHit =
      !exactHit &&
      files.some((file) => {
        const name = fileBasename(file);
        return targets.some(
          (target) => fileBasename(target) === name && name.length > 0,
        );
      });
    if (exactHit) {
      if (!seen.has(fact.id)) {
        exact.push(fact.id);
        seen.add(fact.id);
      }
    } else if (baseHit && !seen.has(fact.id)) {
      basename.push(fact.id);
      seen.add(fact.id);
    }
  }

  return [...exact, ...basename];
}
