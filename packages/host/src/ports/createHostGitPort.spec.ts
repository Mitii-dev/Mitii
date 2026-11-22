import { describe, expect, it } from 'vitest';

import { Libgit2GitAdapter, NodeGitAdapter } from '@mitii/sdk';

import { createHostGitPort } from './createHostGitPort.js';

describe('createHostGitPort', () => {
  it('forceCli returns NodeGitAdapter', () => {
    const port = createHostGitPort({ forceCli: true });
    expect(port).toBeInstanceOf(NodeGitAdapter);
  });

  it('default returns Libgit2GitAdapter wrapping CLI fallback', () => {
    const port = createHostGitPort();
    expect(port).toBeInstanceOf(Libgit2GitAdapter);
  });
});
