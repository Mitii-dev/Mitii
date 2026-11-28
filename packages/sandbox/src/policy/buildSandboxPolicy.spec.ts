import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildSandboxPolicy,
  SANDBOX_DEFAULT_DENY_READ_RELATIVE,
} from './buildSandboxPolicy.js';

const root = path.resolve('/tmp/mitii-sandbox-policy');

describe('buildSandboxPolicy', () => {
  it('skips default deny-read floor when sandbox is disabled', () => {
    const policy = buildSandboxPolicy({
      workspaceRoot: root,
      enabled: false,
    });
    expect(policy.enabled).toBe(false);
    expect(policy.denyReadPaths ?? []).toEqual([]);
  });

  it('applies default deny-read relative paths when enabled', () => {
    const policy = buildSandboxPolicy({
      workspaceRoot: root,
      enabled: true,
    });
    for (const rel of SANDBOX_DEFAULT_DENY_READ_RELATIVE) {
      expect(policy.denyReadPaths).toContain(path.join(root, rel));
    }
  });

  it('projects optional grant scopes after the floor', () => {
    const policy = buildSandboxPolicy({
      workspaceRoot: root,
      enabled: true,
      network: 'allow',
      scopes: {
        writePaths: ['packages'],
        allowedEffects: ['workspace_read', 'process_execute'],
      },
    });
    expect(policy.writablePaths).toContain(path.join(root, 'packages'));
    expect(policy.network).toBe('deny');
  });

  it('merges protectedPathGlobs tighten-only', () => {
    const policy = buildSandboxPolicy({
      workspaceRoot: root,
      enabled: true,
      applyDefaultDenyReadPaths: false,
      protectedPathGlobs: ['.secrets'],
    });
    expect(policy.denyReadPaths).toContain(path.join(root, '.secrets'));
  });

  it('can disable the default deny-read floor', () => {
    const policy = buildSandboxPolicy({
      workspaceRoot: root,
      enabled: true,
      applyDefaultDenyReadPaths: false,
    });
    expect(policy.denyReadPaths ?? []).toEqual([]);
  });
});
