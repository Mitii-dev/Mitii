import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildHostSandboxPolicy,
  SANDBOX_DEFAULT_DENY_READ_RELATIVE,
} from './buildHostSandboxPolicy.js';

const root = path.resolve('/tmp/mitii-host-sandbox');

describe('buildHostSandboxPolicy', () => {
  it('skips default deny-read floor when sandbox is disabled', () => {
    const policy = buildHostSandboxPolicy({
      workspaceRoot: root,
      enabled: false,
    });
    expect(policy.enabled).toBe(false);
    expect(policy.denyReadPaths ?? []).toEqual([]);
  });

  it('applies default deny-read relative paths when enabled', () => {
    const policy = buildHostSandboxPolicy({
      workspaceRoot: root,
      enabled: true,
      applyUserSafetyProtectedPaths: false,
    });
    for (const rel of SANDBOX_DEFAULT_DENY_READ_RELATIVE) {
      expect(policy.denyReadPaths).toContain(path.join(root, rel));
    }
  });

  it('projects optional grant scopes after the floor', () => {
    const policy = buildHostSandboxPolicy({
      workspaceRoot: root,
      enabled: true,
      network: 'allow',
      applyUserSafetyProtectedPaths: false,
      scopes: {
        writePaths: ['packages'],
        allowedEffects: ['workspace_read', 'process_execute'],
      },
    });
    expect(policy.writablePaths).toContain(path.join(root, 'packages'));
    expect(policy.network).toBe('deny');
  });

  it('can disable the default deny-read floor', () => {
    const policy = buildHostSandboxPolicy({
      workspaceRoot: root,
      enabled: true,
      applyDefaultDenyReadPaths: false,
      applyUserSafetyProtectedPaths: false,
    });
    expect(policy.denyReadPaths ?? []).toEqual([]);
  });
});
