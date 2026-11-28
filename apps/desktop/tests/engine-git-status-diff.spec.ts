import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { getGitFileDiff } from '../src/engine/git/status.js';

describe('getGitFileDiff', () => {
  it('synthesizes a textual add diff outside a git repo', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mitii-diff-'));
    try {
      const rel = 'priya-v1/new-design.html';
      await mkdir(path.join(root, 'priya-v1'), { recursive: true });
      await writeFile(
        path.join(root, rel),
        '<!DOCTYPE html>\n<html><body>hello</body></html>\n',
        'utf8',
      );

      const { diff } = await getGitFileDiff(root, rel);
      expect(diff).toContain('new-design.html');
      expect(diff).toContain('+<!DOCTYPE html>');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
