/**
 * Prefer libgit2 (`es-git`) for status; fall back to CLI NodeGitAdapter.
 */

import {
  Libgit2GitAdapter,
  NodeGitAdapter,
  type GitPort,
} from '@mitii/sdk';

export interface CreateHostGitPortOptions {
  maxOutputBytes?: number;
  timeoutMs?: number;
  /** Force CLI-only (tests / environments without native bindings). */
  forceCli?: boolean;
}

export function createHostGitPort(
  options: CreateHostGitPortOptions = {},
): GitPort {
  const cli = new NodeGitAdapter({
    ...(options.maxOutputBytes !== undefined
      ? { maxOutputBytes: options.maxOutputBytes }
      : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });
  if (options.forceCli) {
    return cli;
  }
  return new Libgit2GitAdapter(cli, {
    ...(options.maxOutputBytes !== undefined
      ? { maxOutputBytes: options.maxOutputBytes }
      : {}),
  });
}
