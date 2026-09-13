import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { persistExcalidrawFromToolResult } from '../src/excalidrawArtifacts.js';

describe('persistExcalidrawFromToolResult', () => {
  it('writes excalidraw, svg, artifact md, docs md, and LATEST.md', () => {
    const root = mkdtempSync(join(tmpdir(), 'mitii-excalidraw-'));
    try {
      const result = persistExcalidrawFromToolResult({
        workspaceRoot: root,
        threadId: 'thread_1',
        event: {
          serverId: 'excalidraw',
          serverName: 'Excalidraw',
          toolName: 'create_view',
          args: {
            elements: [
              {
                type: 'rectangle',
                x: 10,
                y: 20,
                width: 120,
                height: 60,
                strokeColor: '#111',
                backgroundColor: '#eef',
              },
              {
                type: 'text',
                x: 20,
                y: 35,
                width: 100,
                height: 24,
                text: 'BillBuddy flow',
                fontSize: 16,
                strokeColor: '#111',
              },
            ],
          },
          result: {
            content: 'ok',
            structuredContent: { checkpointId: 'abcdef1234567890' },
            isError: false,
          },
        },
      });

      expect(result).toBeTruthy();
      expect(result!.title).toBe('BillBuddy flow');
      expect(result!.paths.relativeDocsMd).toMatch(/^docs\/diagrams\//);
      expect(result!.paths.relativeMd).toMatch(
        /^\.mitii\/artifacts\/excalidraw\//,
      );

      const md = readFileSync(result!.paths.mdPath, 'utf8');
      expect(md).toContain('![BillBuddy flow](./diagram.svg)');
      expect(md).toContain('diagram.excalidraw');

      const docsMd = readFileSync(result!.paths.docsMdPath!, 'utf8');
      expect(docsMd).toContain('BillBuddy flow');
      expect(docsMd).toContain('.svg');

      const latest = readFileSync(
        join(root, '.mitii/artifacts/excalidraw/LATEST.md'),
        'utf8',
      );
      expect(latest).toContain('BillBuddy flow');

      const svg = readFileSync(result!.paths.svgPath, 'utf8');
      expect(svg).toContain('<svg');
      expect(svg).toContain('BillBuddy flow');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
