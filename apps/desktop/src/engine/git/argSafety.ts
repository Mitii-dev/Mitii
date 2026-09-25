/**
 * Argv-only git hardening for Desktop mutations.
 * Mirrors packages/v8 GitArgSafety without importing V8 internals (REPO_LAYOUT).
 */

export class DesktopGitArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DesktopGitArgError';
  }
}

export function assertSafeGitArg(value: string, label: string): void {
  if (value.length === 0) {
    throw new DesktopGitArgError(`${label} must not be empty.`);
  }
  if (value.startsWith('-')) {
    throw new DesktopGitArgError(
      `${label} must not start with "-": "${value}".`,
    );
  }
  if (value.includes('\0')) {
    throw new DesktopGitArgError(`${label} must not contain null bytes.`);
  }
}

export function assertSafeGitPathArgs(paths: readonly string[]): void {
  for (const entry of paths) {
    assertSafeGitArg(entry, 'git path');
  }
}

export function appendPathsAfterDoubleDash(
  argv: string[],
  paths: readonly string[],
): string[] {
  if (paths.length === 0) return argv;
  assertSafeGitPathArgs(paths);
  return [...argv, '--', ...paths];
}
