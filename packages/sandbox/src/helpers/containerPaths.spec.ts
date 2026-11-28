import { describe, expect, it } from 'vitest';

import {
  mapCwdToContainer,
  toContainerPath,
  toVolumeSpec,
} from './containerPaths.js';

describe('containerPaths', () => {
  it('passes unix paths through', () => {
    expect(toContainerPath('/tmp/ws', 'linux')).toBe('/tmp/ws');
    expect(toVolumeSpec('/tmp/ws', 'linux')).toBe('/tmp/ws:/tmp/ws');
  });

  it('maps Windows drive paths into Linux container paths', () => {
    expect(toContainerPath('C:\\Users\\a\\ws', 'win32')).toBe('/c/Users/a/ws');
    expect(toContainerPath('D:/proj', 'win32')).toBe('/d/proj');
    expect(toVolumeSpec('C:\\Users\\a\\ws', 'win32')).toBe(
      'C:\\Users\\a\\ws:/c/Users/a/ws',
    );
  });

  it('maps cwd under workspace on Windows', () => {
    expect(
      mapCwdToContainer({
        cwd: 'C:\\Users\\a\\ws\\packages\\host',
        workspaceRoot: 'C:\\Users\\a\\ws',
        os: 'win32',
      }),
    ).toBe('/c/Users/a/ws/packages/host');

    expect(
      mapCwdToContainer({
        cwd: undefined,
        workspaceRoot: 'C:\\Users\\a\\ws',
        os: 'win32',
      }),
    ).toBe('/c/Users/a/ws');
  });

  it('maps cwd under workspace on unix without change', () => {
    expect(
      mapCwdToContainer({
        cwd: '/tmp/ws/src',
        workspaceRoot: '/tmp/ws',
        os: 'linux',
      }),
    ).toBe('/tmp/ws/src');
  });
});
