import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createDesktopClient } from '../src/engine/createDesktopHost.js';
import {
  generateEngineToken,
  startEngineServer,
} from '../src/engine/server.js';

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('engine server', () => {
  it('serves health and streams echo prompt as NDJSON', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mitii-desktop-'));
    temps.push(cwd);
    const { client, mode } = await createDesktopClient({
      cwd,
      forceEcho: true,
    });
    expect(mode).toBe('echo');

    const token = generateEngineToken();
    const handle = await startEngineServer({
      client,
      mode,
      workspaceRoot: cwd,
      host: '127.0.0.1',
      port: 0,
      token,
    });

    try {
      const health = await fetch(`${handle.url}/health`);
      expect(health.status).toBe(200);
      const body = (await health.json()) as {
        ok: boolean;
        protocol: string;
        mode: string;
      };
      expect(body.ok).toBe(true);
      expect(body.protocol).toBe('mitii-desktop/v1');
      expect(body.mode).toBe('echo');

      const denied = await fetch(`${handle.url}/v1/prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'hi' }),
      });
      expect(denied.status).toBe(401);

      const res = await fetch(`${handle.url}/v1/prompt`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ prompt: 'hello desktop', mode: 'ask' }),
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      const lines = text
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { op: string });
      expect(lines[0]?.op).toBe('ready');
      expect(lines.some((l) => l.op === 'result')).toBe(true);
    } finally {
      await handle.close();
    }
  }, 60_000);
});
