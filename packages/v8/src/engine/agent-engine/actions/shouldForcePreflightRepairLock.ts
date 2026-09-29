/**
 * When preflight already captured typecheck/build errors, start the mutate
 * loop under mutation discipline (no broad rediscovery) so repair asks do not
 * burn the stall budget hunting unrelated files.
 *
 * Do not lock when the user request names a different set of files (a pasted
 * test-failure dump, for example). Those preflight errors are a side capture;
 * treating them as the task blocks the reads the real fix needs.
 */
export function shouldForcePreflightRepairLock(params: {
  route: string;
  maximumWorkspaceEffect: string;
  preflightErrorCount: number;
  changedFilesCount?: number;
  /** Raw user request. Omitted callers keep the error-count lock. */
  userPrompt?: string;
  /** Paths of preflight errors. Used to see whether the request names them. */
  diagnosticPaths?: readonly string[];
}): boolean {
  if ((params.changedFilesCount ?? 0) > 0) {
    return false;
  }
  if (params.route !== "execute") {
    return false;
  }
  if (params.maximumWorkspaceEffect !== "write") {
    return false;
  }
  if (params.preflightErrorCount <= 0) {
    return false;
  }
  return preflightErrorsMatchUserRequest({
    userPrompt: params.userPrompt,
    diagnosticPaths: params.diagnosticPaths,
  });
}

const CITED_REPO_PATH =
  /\b((?:[\w.-]+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|css|scss|json|md))\b/gi;

/**
 * True when preflight errors are the repair the user asked for.
 * A prompt that cites other files and never mentions a diagnostic path is a
 * different task — the lock must stay off so those files can be read.
 * Missing prompt or missing diagnostic paths keeps the lock (callers that
 * only know the error count).
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

/** Drop preflight errors the user request does not name, when it names other files. */
export function preflightDiagnosticsForUserRequest<T extends { path: string }>(
  diagnostics: readonly T[],
  userPrompt: string | undefined,
): readonly T[] {
  if (
    preflightErrorsMatchUserRequest({
      userPrompt,
      diagnosticPaths: diagnostics.map((diagnostic) => diagnostic.path),
    })
  ) {
    return diagnostics;
  }
  return [];
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
