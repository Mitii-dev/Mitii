import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveSandboxPolicy } from '../contracts/policy.js';
import { projectGrantToOsPolicy } from './projectGrantToOsPolicy.js';

const root = path.resolve('/tmp/mitii-ws');

describe('projectGrantToOsPolicy', () => {
  it('projects write and protected scopes under the workspace', () => {
    const base = resolveSandboxPolicy({
      enabled: true,
      network: 'allow',
      workspaceRoot: root,
      writablePaths: [path.join(root, 'scratch')],
    });
    const next = projectGrantToOsPolicy(base, {
      writePaths: ['src', 'scratch'],
      protectedPaths: ['.env', '.mitii/**'],
      readPaths: ['.'],
    });
    expect(next.writablePaths).toEqual([path.join(root, 'scratch')]);
    expect(next.readablePaths).toContain(root);
    expect(next.denyReadPaths).toEqual(
      expect.arrayContaining([
        path.join(root, '.env'),
        path.join(root, '.mitii'),
      ]),
    );
    expect(next.network).toBe('allow');
  });

  it('forces network deny when allowedEffects omit network_access', () => {
    const base = resolveSandboxPolicy({
      enabled: true,
      network: 'allow',
      workspaceRoot: root,
    });
    const next = projectGrantToOsPolicy(base, {
      allowedEffects: ['workspace_read', 'process_execute'],
    });
    expect(next.network).toBe('deny');
  });

  it('never widens network from deny to allow', () => {
    const base = resolveSandboxPolicy({
      enabled: true,
      network: 'deny',
      workspaceRoot: root,
    });
    const next = projectGrantToOsPolicy(base, {
      allowedEffects: ['network_access'],
      networkHosts: ['example.com'],
    });
    expect(next.network).toBe('deny');
  });

  it('merges extraAllowedRoots into readablePaths', () => {
    const extra = path.resolve('/tmp/extra-root');
    const base = resolveSandboxPolicy({
      enabled: true,
      workspaceRoot: root,
    });
    const next = projectGrantToOsPolicy(base, {
      extraAllowedRoots: [extra],
    });
    expect(next.readablePaths).toContain(extra);
  });

  it('keeps existing denyReadPaths when projecting', () => {
    const prior = path.join(root, '.ssh');
    const base = resolveSandboxPolicy({
      enabled: true,
      workspaceRoot: root,
      denyReadPaths: [prior],
    });
    const next = projectGrantToOsPolicy(base, {
      protectedPathGlobs: ['.env'],
    });
    expect(next.denyReadPaths).toEqual(
      expect.arrayContaining([prior, path.join(root, '.env')]),
    );
  });
});
