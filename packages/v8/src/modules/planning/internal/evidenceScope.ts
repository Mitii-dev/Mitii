import type {
  PlanningBuildEvidence,
  PlanningTaskEvidence,
} from "../contracts";

export function isDiagnosticInAskScope(
  diagnostic: { path: string },
  targets: PlanningTaskEvidence["targets"],
  query: string,
): boolean {
  const diagnosticPath = normalizePath(diagnostic.path);
  if (!diagnosticPath) {
    return false;
  }

  const prefixes = [
    ...targets
      .filter((target) => target.explicit)
      .map((target) => target.value),
    ...extractMentionedPaths(query),
  ]
    .map(normalizePath)
    .filter((value) => value.length > 0);

  if (prefixes.length === 0) {
    return false;
  }

  return prefixes.some((prefix) => pathOverlapsScope(diagnosticPath, prefix));
}

export function filterBuildEvidenceToAskScope(params: {
  buildEvidence?: PlanningBuildEvidence;
  targets: PlanningTaskEvidence["targets"];
  query: string;
}): PlanningBuildEvidence | undefined {
  if (!params.buildEvidence) {
    return undefined;
  }

  const diagnostics = (params.buildEvidence.diagnostics ?? []).filter(
    (diagnostic) =>
      isDiagnosticInAskScope(diagnostic, params.targets, params.query),
  );

  if (diagnostics.length === 0) {
    return undefined;
  }

  return {
    ...params.buildEvidence,
    diagnostics,
  };
}

export function countInScopeErrorDiagnostics(params: {
  buildEvidence?: PlanningBuildEvidence;
  targets: PlanningTaskEvidence["targets"];
  query: string;
}): number {
  return (params.buildEvidence?.diagnostics ?? []).filter(
    (diagnostic) =>
      diagnostic.severity === "error" &&
      isDiagnosticInAskScope(diagnostic, params.targets, params.query),
  ).length;
}

function pathOverlapsScope(path: string, scope: string): boolean {
  const normalizedScope = scope.replace(/\/+$/, "");
  if (
    path === normalizedScope ||
    path.startsWith(`${normalizedScope}/`) ||
    normalizedScope.startsWith(`${path}/`)
  ) {
    return true;
  }

  // Compilers often emit project-relative paths (`src/Foo.tsx`) while the
  // user/@mention target is the package root (`packages/mui-builder`).
  // Count those as in-scope unless the path already names a different
  // packages/* or apps/* root.
  const projectRoot = normalizedScope.match(/^(packages|apps)\/[^/]+/);
  if (!projectRoot) {
    return false;
  }
  const otherRoot = /^(?:packages|apps)\//;
  return !otherRoot.test(path);
}

function extractMentionedPaths(query: string): string[] {
  const matches = query.matchAll(/@([^\s,;:)]+)/g);
  return [...matches].map((match) => match[1] ?? "");
}

function normalizePath(value: string): string {
  return value
    .trim()
    .replace(/^@+/, "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}
