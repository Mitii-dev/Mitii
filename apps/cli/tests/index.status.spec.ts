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
        published: { status: string; descriptor?: { readiness: string } };
        fileCount: number;
      };
      expect(indexPayload.published.status).toBe('published');
      expect(indexPayload.fileCount).toBeGreaterThan(0);

      stdout.length = 0;
      const statusCode = await main(
        ['node', 'mitii', 'status', '--cwd', dir, '--json', '--echo'],
        io,
      );
      expect(statusCode).toBe(0);
      const statusPayload = JSON.parse(stdout.join('')) as {
        latest: { readiness: string; workspaceId: string } | null;
      };
      expect(statusPayload.latest?.readiness).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
