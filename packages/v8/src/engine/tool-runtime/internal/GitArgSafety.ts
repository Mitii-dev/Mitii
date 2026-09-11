/**
 * Hardening for argv-backed git tooling (servers-main git server technique).
 * Treat user strings as data: reject leading `-`, use `--` before paths.
 */

export class GitArgSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitArgSafetyError";
  }
}

/** Reject refs/args that git would interpret as flags. */
export function assertSafeGitArg(value: string, label: string): void {
  if (value.length === 0) {
    throw new GitArgSafetyError(`${label} must not be empty.`);
  }
  if (value.startsWith("-")) {
    throw new GitArgSafetyError(
      `${label} must not start with "-": "${value}".`,
    );
  }
  if (value.includes("\0")) {
    throw new GitArgSafetyError(`${label} must not contain null bytes.`);
  }
}

export function assertSafeGitPathArgs(paths: readonly string[]): void {
  for (const entry of paths) {
    assertSafeGitArg(entry, "git path");
  }
}

/**
 * Append path args after `--` so filenames cannot be parsed as git flags.
 */
export function appendPathsAfterDoubleDash(
  argv: string[],
  paths: readonly string[],
): string[] {
  if (paths.length === 0) {
    return argv;
  }
  assertSafeGitPathArgs(paths);
  return [...argv, "--", ...paths];
}
