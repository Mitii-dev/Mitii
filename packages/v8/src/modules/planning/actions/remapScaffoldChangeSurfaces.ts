import type {
  DiscoveryChangeSurface,
  DiscoveryFileRef,
  DiscoveryTarget,
} from "../contracts";

const PACKAGE_PREFIX = /^(packages\/[^/]+)/i;
const CREATE_CHUNK =
  /\b(?:create|scaffold|clone|copy|spin\s*up|generate)\b([^.\n]{0,120})/i;
const LIKE_CHUNK =
  /\b(?:like|from|based\s+on|mirroring|modeled\s+on|similar\s+to)\b([^.\n]{0,120})/i;
const STOP_NAMES = new Set([
  "a",
  "an",
  "the",
  "new",
  "package",
  "packages",
  "named",
  "folder",
  "directory",
  "module",
  "same",
  "with",
]);

/**
 * When the ask is "scaffold/create package B like package A", rewrite
 * discovery change surfaces under A into write paths under B. Source paths
 * stay as evidence text so planning can still cite the template.
 *
 * Deterministic — no LLM. Safe no-op when source/target cannot be inferred.
 */
export function remapScaffoldChangeSurfaces(params: {
  objective: string;
  surfaces: readonly DiscoveryChangeSurface[];
  explicitTargets?: readonly DiscoveryTarget[];
  filesRead?: readonly DiscoveryFileRef[];
}): DiscoveryChangeSurface[] {
  if (params.surfaces.length === 0) {
    return [];
  }

  const mapping = resolveScaffoldPackageMapping({
    objective: params.objective,
    explicitTargets: params.explicitTargets ?? [],
    filesRead: params.filesRead ?? [],
  });
  if (!mapping) {
    return params.surfaces.map((surface) => ({ ...surface }));
  }

  const { sourcePrefix, targetPrefix } = mapping;
  return params.surfaces.map((surface) => {
    const path = normalizePath(surface.path);
    if (!path.startsWith(`${sourcePrefix}/`) && path !== sourcePrefix) {
      return { ...surface, path };
    }
    const rewritten =
      path === sourcePrefix
        ? targetPrefix
        : `${targetPrefix}${path.slice(sourcePrefix.length)}`;
    return {
      ...surface,
      path: rewritten,
      actionHint: surface.actionHint.includes("Create")
        ? surface.actionHint
        : `Create/adapt toward ${targetPrefix}`,
      evidence: `${surface.evidence} (templated from ${path})`.slice(0, 500),
    };
  });
}

export function resolveScaffoldPackageMapping(params: {
  objective: string;
  explicitTargets?: readonly DiscoveryTarget[];
  filesRead?: readonly DiscoveryFileRef[];
}): { sourcePrefix: string; targetPrefix: string } | undefined {
  const objective = params.objective.trim();
  if (objective.length === 0) {
    return undefined;
  }

  const createName = extractPackageNameFromChunk(
    objective.match(CREATE_CHUNK)?.[1] ?? "",
  );
  const likeName = extractPackageNameFromChunk(
    objective.match(LIKE_CHUNK)?.[1] ?? "",
  );

  const explicitFolders = (params.explicitTargets ?? [])
    .filter((target) => target.explicit && target.kind === "folder")
    .map((target) => packagePrefix(target.value) ?? normalizePath(target.value))
    .filter(Boolean);

  const readPackages = packageFrequency(
    (params.filesRead ?? []).map((file) => packagePrefix(file.path)),
  );

  let targetPrefix: string | undefined;
  if (createName) {
    targetPrefix = toPackagePrefix(createName);
  } else if (explicitFolders.length > 0) {
    targetPrefix =
      explicitFolders.find((folder) => folder !== readPackages[0]) ??
      explicitFolders[0];
  }

  let sourcePrefix: string | undefined;
  if (likeName) {
    sourcePrefix = toPackagePrefix(likeName);
  } else if (readPackages.length > 0) {
    sourcePrefix = readPackages.find((pkg) => pkg !== targetPrefix);
  }

  if (!targetPrefix || !sourcePrefix || targetPrefix === sourcePrefix) {
    return undefined;
  }

  if (!CREATE_CHUNK.test(objective) && explicitFolders.length === 0) {
    return undefined;
  }

  return { sourcePrefix, targetPrefix };
}

function extractPackageNameFromChunk(chunk: string): string | undefined {
  const text = chunk.trim();
  if (text.length === 0) {
    return undefined;
  }
  const packaged = text.match(/packages\/([A-Za-z][\w.-]*)/i)?.[1];
  if (packaged && !STOP_NAMES.has(packaged.toLowerCase())) {
    return packaged;
  }
  const afterPackage = text.match(
    /\bpackage\s+(?:named\s+)?[`'"]?([A-Za-z][\w.-]{2,})[`'"]?/i,
  )?.[1];
  if (afterPackage && !STOP_NAMES.has(afterPackage.toLowerCase())) {
    return afterPackage;
  }
  const quoted = text.match(/[`'"]([A-Za-z][\w.-]{2,})[`'"]/)?.[1];
  if (quoted && !STOP_NAMES.has(quoted.toLowerCase())) {
    return quoted;
  }
  const tokens = text.match(/[A-Za-z][\w.-]{2,}/g) ?? [];
  for (const token of tokens) {
    if (!STOP_NAMES.has(token.toLowerCase())) {
      return token;
    }
  }
  return undefined;
}

function toPackagePrefix(nameOrPath: string): string {
  const normalized = normalizePath(nameOrPath);
  const existing = packagePrefix(normalized);
  if (existing) {
    return existing;
  }
  if (normalized.startsWith("packages/")) {
    return normalized.split("/").slice(0, 2).join("/");
  }
  return `packages/${normalized}`;
}

function packagePrefix(path: string): string | undefined {
  const match = normalizePath(path).match(PACKAGE_PREFIX);
  return match?.[1];
}

function packageFrequency(
  packages: readonly (string | undefined)[],
): string[] {
  const counts = new Map<string, number>();
  for (const pkg of packages) {
    if (!pkg) continue;
    counts.set(pkg, (counts.get(pkg) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([pkg]) => pkg);
}

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}
