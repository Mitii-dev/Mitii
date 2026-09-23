import { describe, expect, it } from 'vitest';

import {
  projectFolderName,
  projectIdSuffix,
  projectSlugFromRoot,
  resolveWorkspaceStorage,
} from '../src/shared/storage-layout.js';

describe('storage-layout projects path', () => {
  it('builds friendly project slugs', () => {
    expect(projectSlugFromRoot('/tmp/gitea-main')).toBe('gitea-main');
    expect(projectSlugFromRoot('/tmp/My Cool Repo!')).toBe('My-Cool-Repo');
  });

  it('uses slug--id under Root/projects', () => {
    const layout = resolveWorkspaceStorage({
      workspaceRoot: '/Users/me/apps/billbuddy-test-suite',
      workspaceId: 'ws_abcdef0123456789',
      rootStoragePath: '/data/mitii-root',
    });
    expect(layout.usesRootStorage).toBe(true);
    expect(layout.projectSlug).toBe('billbuddy-test-suite');
    expect(layout.projectFolderName).toBe(
      projectFolderName('billbuddy-test-suite', 'ws_abcdef0123456789'),
    );
    expect(layout.dataPath.replace(/\\/g, '/')).toBe(
      '/data/mitii-root/projects/billbuddy-test-suite--abcdef0123456789',
    );
    expect(layout.legacyDataPath?.replace(/\\/g, '/')).toBe(
      '/data/mitii-root/workspaces/ws_abcdef0123456789',
    );
    expect(projectIdSuffix('ws_abcdef0123456789')).toBe('abcdef0123456789');
  });

  it('falls back to in-repo .mitii without root', () => {
    const layout = resolveWorkspaceStorage({
      workspaceRoot: '/repo/demo',
      workspaceId: 'ws_deadbeefdeadbeef',
      rootStoragePath: null,
    });
    expect(layout.usesRootStorage).toBe(false);
    expect(layout.dataPath.replace(/\\/g, '/')).toMatch(/\/demo\/\.mitii$/);
  });
});
