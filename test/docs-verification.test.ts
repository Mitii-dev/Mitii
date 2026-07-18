import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  verifyDocumentationFiles,
} from '../src/core/runtime/docsVerification';
import { resolveProjectVerifyCommands } from '../src/core/runtime/verifyCommandDiscovery';

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe('route-specific documentation verification', () => {
  it('validates local paths, anchors, and fenced code blocks', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'mitii-docs-'));
    workspaces.push(workspace);
    mkdirSync(join(workspace, 'docs'));
    writeFileSync(join(workspace, 'docs', 'guide.md'), '# Install\n\nDetails\n');
    writeFileSync(
      join(workspace, 'README.md'),
      '# Project\n\n[Install](docs/guide.md#install)\n\n[Missing](docs/missing.md)\n\n```ts\nconst value = 1;\n'
    );

    const result = verifyDocumentationFiles(workspace, ['README.md']);
    expect(result.checkedFiles).toEqual(['README.md']);
    expect(result.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        'Unclosed fenced code block.',
        'Missing referenced path: docs/missing.md',
      ])
    );
    expect(result.issues.some((issue) => issue.message.includes('#install'))).toBe(false);
  });

  it('skips production builds for README-only changes', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'mitii-readme-'));
    workspaces.push(workspace);
    writeFileSync(join(workspace, 'README.md'), '# Project\n');
    writeFileSync(join(workspace, 'package.json'), JSON.stringify({
      scripts: { build: 'vite build', lint: 'eslint .' },
    }));

    const plan = resolveProjectVerifyCommands(workspace, [], {
      touchedFiles: ['README.md'],
      userMessage: 'Update README',
    });
    expect(plan.commands).toEqual([]);
    expect(plan.notes.join(' ')).toContain('skip application production builds');
  });
});
