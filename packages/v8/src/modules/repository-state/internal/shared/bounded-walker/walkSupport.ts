import { BOUNDED_WALKER_CONSTANTS } from "./constants";
import type {
  BoundedWalkInput,
  NormalizedWalkOptions,
  WalkState,
} from "./types";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }

  return String(error.code);
}

export function isMissingPathError(error: unknown): boolean {
  const code = getErrorCode(error);

  return (
    code === "ENOENT" ||
    code === "ENOTDIR" ||
    code === "FileNotFound" ||
    code === "EntryNotFound"
  );
}

function validateLimit(name: string, value: number, allowZero: boolean): void {
  const minimum = allowZero ? 0 : 1;

  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(
      `${name} must be a safe integer ` +
        `greater than or equal to ${minimum}.`,
    );
  }
}

export function normalizeWalkOptions(input: BoundedWalkInput): NormalizedWalkOptions {
  const maximumDepth =
    input.maximumDepth ?? BOUNDED_WALKER_CONSTANTS.DEFAULT_MAXIMUM_DEPTH;

  const maximumFiles =
    input.maximumFiles ?? BOUNDED_WALKER_CONSTANTS.DEFAULT_MAXIMUM_FILES;

  const maximumDirectories =
    input.maximumDirectories ??
    BOUNDED_WALKER_CONSTANTS.DEFAULT_MAXIMUM_DIRECTORIES;

  const timeoutMs =
    input.timeoutMs ?? BOUNDED_WALKER_CONSTANTS.DEFAULT_TIMEOUT_MS;

  validateLimit("maximumDepth", maximumDepth, true);

  validateLimit("maximumFiles", maximumFiles, false);

  validateLimit("maximumDirectories", maximumDirectories, false);

  validateLimit("timeoutMs", timeoutMs, false);

  return {
    maximumDepth,
    maximumFiles,
    maximumDirectories,

    timeoutMs,
    deadline: Date.now() + timeoutMs,

    followSymbolicLinks: input.followSymbolicLinks ?? false,

    shouldIgnore: input.shouldIgnore,
    abortSignal: input.abortSignal,
  };
}

export function createWalkState(): WalkState {
  return {
    entries: [],
    warnings: [],

    filesVisited: 0,
    directoriesVisited: 0,
    symbolicLinksVisited: 0,
    ignoredEntries: 0,

    truncated: false,
    cancelled: false,
    timedOut: false,
    stopped: false,

    reportedMaximumFiles: false,
    reportedMaximumDirectories: false,
    reportedTimeout: false,

    visitedRealDirectories: new Set<string>(),
  };
}
