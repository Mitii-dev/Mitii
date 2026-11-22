/**
 * Desktop git argv safety — delegates to shared @mitii/sdk helpers.
 * `DesktopGitArgError` stays a local Error subclass for existing catch sites / tests.
 */

import {
  assertSafeGitArg as assertSafeGitArgShared,
  assertSafeGitPathArgs as assertSafeGitPathArgsShared,
  appendPathsAfterDoubleDash as appendPathsAfterDoubleDashShared,
} from '@mitii/sdk';

export class DesktopGitArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DesktopGitArgError';
  }
}

function rethrowAsDesktop(error: unknown): never {
  const message =
    error instanceof Error ? error.message : String(error);
  throw new DesktopGitArgError(message);
}

export function assertSafeGitArg(value: string, label: string): void {
  try {
    assertSafeGitArgShared(value, label);
  } catch (error: unknown) {
    rethrowAsDesktop(error);
  }
}

export function assertSafeGitPathArgs(paths: readonly string[]): void {
  try {
    assertSafeGitPathArgsShared(paths);
  } catch (error: unknown) {
    rethrowAsDesktop(error);
  }
}

export function appendPathsAfterDoubleDash(
  argv: string[],
  paths: readonly string[],
): string[] {
  try {
    return appendPathsAfterDoubleDashShared(argv, paths);
  } catch (error: unknown) {
    rethrowAsDesktop(error);
  }
}
