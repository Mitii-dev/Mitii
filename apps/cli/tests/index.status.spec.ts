import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { parseCliArgs, main } from '../src/cli.js';
import { createDefaultSessionIo } from '../src/session.js';

describe('CLI Phase 15 commands', () => {
  it('parses index, status, session, export-session', () => {
    expect(parseCliArgs(['node', 'mitii', 'index', '--json']).command).toBe(
      'index',
    );
    expect(parseCliArgs(['node', 'mitii', 'status']).command).toBe('status');
    expect(parseCliArgs(['node', 'mitii', 'session']).command).toBe('session');
    const exported = parseCliArgs([
      'node',
      'mitii',
      'export-session',
      'hello',
      '--out',
      '/tmp/out.json',
      '--echo',
    ]);
    expect(exported.command).toBe('export-session');
    expect(exported.prompt).toBe('hello');
    expect(exported.exportPath).toBe('/tmp/out.json');
  });

  it('indexes and reads status via SDK repository state', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-cli-index-'));
    writeFileSync(join(dir, 'readme.txt'), 'hello');
    const stdout: string[] = [];
    const stderr: string[] = [];
    const io = createDefaultSessionIo();
    io.writeStdout = (c) => {
      stdout.push(c);
    };
    io.writeStderr = (c) => {
      stderr.push(c);
    };
    io.prompt = async () => '';

    try {
      const indexCode = await main(
        ['node', 'mitii', 'index', '--cwd', dir, '--json', '--echo'],
        io,
      );
      expect(indexCode).toBe(0);
      const indexPayload = JSON.parse(stdout.join('')) as {
        published: {
          status: string;
          descriptor?: {
            readiness: string;
            roots: Array<{
              codeIndexRevision?: string;
              textIndexRevision?: string;
              capabilities: Array<{ capability: string; status: string }>;
            }>;
          };
        };
        fileCount: number;
        indexMode?: string;
        capabilitySummary: Array<{ capability: string; status: string }>;
      };
      expect(indexPayload.published.status).toBe('published');
      expect(indexPayload.fileCount).toBeGreaterThan(0);
      expect(indexPayload.capabilitySummary).toContainEqual(
        expect.objectContaining({
          capability: 'textIndex',
          status: indexPayload.indexMode === 'full' ? 'ready' : 'unavailable',
        }),
      );
      const root = indexPayload.published.descriptor?.roots[0];
      if (indexPayload.indexMode === 'full') {
        expect(root?.codeIndexRevision).toBeTruthy();
        expect(root?.textIndexRevision).toBeTruthy();
        expect(root?.capabilities).toContainEqual(
          expect.objectContaining({
            capability: 'codeIndex',
            status: 'ready',
          }),
        );
        expect(root?.capabilities).toContainEqual(
          expect.objectContaining({
            capability: 'textIndex',
            status: 'ready',
          }),
        );
      } else {
        expect(root?.codeIndexRevision).toBeUndefined();
        expect(root?.textIndexRevision).toBeUndefined();
      }
      const vectorCapability = root?.capabilities.find(
        (entry) => entry.capability === 'vectorIndex',
      );
      expect(vectorCapability).toBeTruthy();
      expect(['ready', 'unavailable', 'degraded']).toContain(
        vectorCapability?.status,
      );

      stdout.length = 0;
      const statusCode = await main(
        ['node', 'mitii', 'status', '--cwd', dir, '--json', '--echo'],
        io,
      );
      expect(statusCode).toBe(0);
      const statusPayload = JSON.parse(stdout.join('')) as {
        latest: { readiness: string; workspaceId: string } | null;
        capabilitySummary?: Array<{ capability: string; status: string }>;
      };
      expect(statusPayload.latest?.readiness).toBeTruthy();
      const statusVector = statusPayload.capabilitySummary?.find(
        (entry) => entry.capability === 'vectorIndex',
      );
      expect(statusVector).toBeTruthy();
      expect(['ready', 'unavailable', 'degraded']).toContain(statusVector?.status);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
