/**
 * User-cited repo paths beat unrelated preflight diagnostics.
 * When the prompt names files that are not among preflight error paths,
 * do not start under preflight repair lock.
 */

const CITED_REPO_PATH =
  /\b((?:[\w.-]+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|css|scss|json|md))\b/gi;

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
 * True when preflight errors match the user's request.
 * A prompt that cites other files and never mentions a diagnostic path is a
 * different task — repair lock stays off.
 */
export function preflightErrorsMatchUserRequest(params: {
  userPrompt?: string;
  diagnosticPaths?: readonly string[];
}): boolean {
  const prompt = params.userPrompt?.trim() ?? "";
  const diagnosticPaths = (params.diagnosticPaths ?? [])
    .map(normalizeRepoPath)
    .filter((path) => path.length > 0 && path !== ".");
  if (!prompt || diagnosticPaths.length === 0) {
    return true;
  }
  const cited = citedRepoPaths(prompt);
  if (cited.length === 0) {
    return true;
  }
  const lowered = prompt.toLowerCase();
  return diagnosticPaths.some(
    (path) =>
      lowered.includes(path) || cited.some((citedPath) => citedPath === path),
  );
}

/** Drop preflight diagnostics the user request does not name, when it names other files. */
export function preflightDiagnosticsForUserRequest<T extends { path: string }>(
  diagnostics: readonly T[],
  userPrompt: string | undefined,
): readonly T[] {
  const prompt = userPrompt?.trim() ?? "";
  if (!prompt || diagnostics.length === 0) {
    return diagnostics;
  }
  const cited = citedRepoPaths(prompt);
  if (cited.length === 0) {
    return diagnostics;
  }
  const lowered = prompt.toLowerCase();
  const matching = diagnostics.filter((item) => {
    const path = normalizeRepoPath(item.path);
    return path.length > 0 && (lowered.includes(path) || cited.includes(path));
  });
  // User named files but none overlap preflight → treat as unrelated noise.
  if (matching.length === 0) {
    return [];
  }
  return matching;
}

function citedRepoPaths(prompt: string): string[] {
  const paths: string[] = [];
  const re = new RegExp(CITED_REPO_PATH.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(prompt)) !== null) {
    const path = normalizeRepoPath(match[1] ?? "");
    if (path) paths.push(path);
  }
  return paths;
}

function normalizeRepoPath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}
