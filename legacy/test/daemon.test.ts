import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { startMitiiDaemon, type MitiiDaemonServerHandle } from '../packages/daemon/src/server';
import { DaemonClient, type DaemonTraceEvent } from '../packages/sdk/src/daemon';

const handles: MitiiDaemonServerHandle[] = [];
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('mitii daemon', () => {
  it('serves health, capabilities, session CRUD, prompt events, and replay', async () => {
    const cwd = tempDir();
    const handle = await startMitiiDaemon({ cwd, port: 0, maxSessions: 2 });
    handles.push(handle);
    const address = handle.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const traces: DaemonTraceEvent[] = [];
    const client = new DaemonClient({
      baseUrl: `http://127.0.0.1:${port}`,
      trace: (event) => traces.push(event),
    });

    await expect(client.health()).resolves.toMatchObject({ ok: true, cwd });
    await expect(client.capabilities()).resolves.toMatchObject({ eventReplay: true });

    const session = await client.createSession({ cwd, mode: 'agent', runtime: 'stub', approval: 'auto' });
    await client.prompt(session.id, { message: 'hello daemon' });

    const events = [];
    for await (const event of client.events(session.id)) {
      events.push(event);
      if (event.data.type === 'done') break;
    }
    expect(events.some((event) => event.data.type === 'assistant_delta')).toBe(true);
    const replayed = [];
    for await (const event of client.events(session.id, 0)) {
      replayed.push(event);
      if (replayed.length >= events.length) break;
    }
    expect(replayed.length).toBeGreaterThan(0);
    expect(traces).toEqual(expect.arrayContaining([
      expect.objectContaining({ direction: 'send', transport: 'http', path: '/health' }),
      expect.objectContaining({ direction: 'receive', transport: 'http', status: 200 }),
      expect.objectContaining({ direction: 'send', transport: 'sse' }),
      expect.objectContaining({ direction: 'receive', transport: 'sse' }),
    ]));
  });

  it('requires token for authenticated requests and enforces session limit', async () => {
    const cwd = tempDir();
    const handle = await startMitiiDaemon({ cwd, port: 0, token: 'secret', maxSessions: 1 });
    handles.push(handle);
    const address = handle.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    await expect(fetch(`http://127.0.0.1:${port}/health`)).resolves.toMatchObject({ status: 401 });
    const client = new DaemonClient({ baseUrl: `http://127.0.0.1:${port}`, token: 'secret' });
    await client.createSession({ cwd, runtime: 'stub' });
    await expect(client.createSession({ cwd, runtime: 'stub' })).rejects.toThrow(/Maximum sessions/);
  });

  it('rejects non-loopback bind without explicit insecure flag', async () => {
    await expect(startMitiiDaemon({ cwd: tempDir(), hostname: '0.0.0.0', port: 0 })).rejects.toThrow(/Refusing non-loopback/);
  });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mitii-daemon-'));
  dirs.push(dir);
  return dir;
}
