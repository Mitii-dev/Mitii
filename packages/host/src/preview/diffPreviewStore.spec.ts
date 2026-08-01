import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileDiffPreviewStore } from './diffPreviewStore.js';

describe('FileDiffPreviewStore', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mitii-preview-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes proposed content under .mitii without mutating the original file', async () => {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'price.ts'), 'export const price = 10;\n');

    const store = new FileDiffPreviewStore(root);
    const preview = await store.writeProposedFile(
      'src/price.ts',
      'export const price = 12;\n',
    );

    await expect(readFile(join(root, 'src', 'price.ts'), 'utf8')).resolves.toBe(
      'export const price = 10;\n',
    );
    await expect(readFile(preview.previewPath, 'utf8')).resolves.toBe(
      'export const price = 12;\n',
    );
    expect(preview.relPath).toBe('src/price.ts');
    expect(preview.previewPath).toContain(
      join('.mitii', 'diff-preview', 'src__price.ts'),
    );
  });

  it('writes old/new patch pairs for side-by-side preview', async () => {
    const store = new FileDiffPreviewStore(root);

    const preview = await store.writePatchPair(
      'apps/cli/src/runReport.ts',
      'old',
      'new',
    );

    await expect(readFile(preview.oldPath, 'utf8')).resolves.toBe('old');
    await expect(readFile(preview.newPath, 'utf8')).resolves.toBe('new');
    expect(preview.oldPath).toContain(
      join('.mitii', 'diff-preview', 'old__apps__cli__src__runReport.ts'),
    );
  });

  it('rejects absolute and escaping preview paths', async () => {
    const store = new FileDiffPreviewStore(root);

    await expect(store.writeProposedFile('/tmp/outside.ts', 'x')).rejects.toThrow(
      /relative/,
    );
    await expect(
      store.writeProposedFile('C:\\tmp\\outside.ts', 'x'),
    ).rejects.toThrow(/relative/);
    await expect(store.writeProposedFile('../outside.ts', 'x')).rejects.toThrow(
      /escapes/,
    );
  });
});
