import type { DiscoveryBrief } from "../contracts";

/**
 * Seed paths for hop-1 impact collection after a discovery pass.
 * Aligns with Change step targetRefs from the discovery allowlist.
 */
export function collectDiscoveryImpactSeedPaths(
  discoveryBrief: DiscoveryBrief,
): string[] {
  return uniquePaths([
    ...discoveryBrief.proposedChangeSurfaces.map((surface) => surface.path),
    ...discoveryBrief.targets
      .filter((target) => target.kind === "file")
      .map((target) => target.value),
  ]);
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const path of paths) {
    const normalized = normalizePath(path);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function normalizePath(value: string): string {
  return (
    value
      .trim()
      .replace(/^@+/, "")
      .replace(/\\/g, "/")
      .replace(/\/+/g, "/")
      .replace(/^\.\//, "")
      .replace(/\/+$/, "") || ""
  );
}
