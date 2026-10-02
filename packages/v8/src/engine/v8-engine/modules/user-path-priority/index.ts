/**
 * User-cited repo paths beat unrelated preflight diagnostics.
 * Preflight is deferred evidence unless the user invite is fix-build language
 * or named paths that overlap diagnostics — never the default first action.
 */

const CITED_REPO_PATH =
  /\b((?:[\w.-]+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|css|scss|json|md|yml|yaml))\b/gi;

/** User ask clearly about build/typecheck/compile repair. */
const FIX_BUILD_ASK =
  /\b(?:fix\s+(?:all\s+)?(?:ts|typescript|type\s*check|typecheck|build|compile)|resolve\s+(?:all\s+)?(?:ts|typescript)\s+errors|type\s*errors?\b|fix\s+(?:the\s+)?(?:preflight|diagnostics?|errors?)\b)/i;

export function userRequestInvitesPreflightRepair(
  userPrompt: string | undefined,
): boolean {
  const prompt = userPrompt?.trim() ?? "";
  if (!prompt) return false;
  return FIX_BUILD_ASK.test(prompt);
}

export function shouldForcePreflightRepairLock(params: {
  route: string;
  maximumWorkspaceEffect: string;
  preflightErrorCount: number;
  changedFilesCount?: number;
  userPrompt?: string;
  diagnosticPaths?: readonly string[];
}): boolean {
  if ((params.changedFilesCount ?? 0) > 0) return false;
  if (params.route !== "execute") return false;
  if (params.maximumWorkspaceEffect !== "write") return false;
  if (params.preflightErrorCount <= 0) return false;
  return preflightErrorsMatchUserRequest({
    userPrompt: params.userPrompt,
    diagnosticPaths: params.diagnosticPaths,
  });
}

/**
 * True when preflight errors match the user's request and may steer first action.
 * Unrelated asks (no fix-build invite, no overlapping cites) → deferred.
 */
export function preflightErrorsMatchUserRequest(params: {
  userPrompt?: string;
  diagnosticPaths?: readonly string[];
}): boolean {
  const prompt = params.userPrompt?.trim() ?? "";
  const diagnosticPaths = (params.diagnosticPaths ?? [])
    .map(normalizeRepoPath)
    .filter((path) => path.length > 0 && path !== ".");
  if (!prompt) {
    return true;
  }
  if (diagnosticPaths.length === 0) {
    return false;
  }
  if (userRequestInvitesPreflightRepair(prompt)) {
    return true;
  }
  const cited = citedRepoPathsFromPrompt(prompt);
  if (cited.length === 0) {
    // Short behavioral asks without file cites — preflight is deferred evidence.
    return false;
  }
  const lowered = prompt.toLowerCase();
  return diagnosticPaths.some(
    (path) =>
      lowered.includes(path) || cited.some((citedPath) => citedPath === path),
  );
}

/**
 * Drop preflight diagnostics the user request does not invite.
 * No cite + no fix-build invite → empty (deferred).
 */
export function preflightDiagnosticsForUserRequest<T extends { path: string }>(
  diagnostics: readonly T[],
  userPrompt: string | undefined,
): readonly T[] {
  const prompt = userPrompt?.trim() ?? "";
  if (!prompt || diagnostics.length === 0) {
    return diagnostics;
  }
  if (userRequestInvitesPreflightRepair(prompt)) {
    return diagnostics;
  }
  const cited = citedRepoPathsFromPrompt(prompt);
  if (cited.length === 0) {
    return [];
  }
  const lowered = prompt.toLowerCase();
  const matching = diagnostics.filter((item) => {
    const path = normalizeRepoPath(item.path);
    return path.length > 0 && (lowered.includes(path) || cited.includes(path));
  });
  return matching;
}

/** File-like paths cited in the user prompt (normalized). */
export function citedRepoPathsFromPrompt(prompt: string): string[] {
  const paths: string[] = [];
  const re = new RegExp(CITED_REPO_PATH.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(prompt)) !== null) {
    const path = normalizeRepoPath(match[1] ?? "");
    if (path) paths.push(path);
  }
  return preferConcreteRepoCites(paths);
}

/**
 * When a paste cites real `packages/` / `apps/` paths, drop orphan fixture
 * paths like `src/present.ts` or bare `present.ts` that appear only in
 * assertion diffs — they are not workspace edit targets.
 */
export function preferConcreteRepoCites(paths: readonly string[]): string[] {
  const normalized = paths
    .map(normalizeRepoPath)
    .filter((path) => path.length > 0);
  if (normalized.length === 0) return [];
  const hasPackageOrApp = normalized.some(
    (path) =>
      path.startsWith("packages/") ||
      path.startsWith("apps/") ||
      path.startsWith("tests/"),
  );
  if (!hasPackageOrApp) {
    return uniquePaths(normalized);
  }
  return uniquePaths(
    normalized.filter((path) => {
      if (
        path.startsWith("packages/") ||
        path.startsWith("apps/") ||
        path.startsWith("tests/")
      ) {
        return true;
      }
      // Keep other rooted multi-segment paths that are not bare `src/...` fixtures.
      if (path.includes("/") && !path.startsWith("src/")) {
        return true;
      }
      return false;
    }),
  );
}

function uniquePaths(paths: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

function normalizeRepoPath(value: string): string {
  let path = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
  // Models omit the leading dot on CI workflows.
  if (/^github\/workflows\//i.test(path)) {
    path = `.github/${path.slice("github/".length)}`;
  }
  return path.toLowerCase();
}
