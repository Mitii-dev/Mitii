import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createBenchmarkApi } from './benchmark-api.mjs';

test('benchmark API serves meta, config, runs, and idle stop', async () => {
  const api = createBenchmarkApi();
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (await api.handle(req, res, url)) return;
      res.writeHead(404);
      res.end('not found');
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const meta = await fetch(`${base}/api/benchmark/meta`).then((r) => r.json());
    assert.ok(meta.totalCases > 0);
    assert.ok(Array.isArray(meta.suites));
    assert.ok(typeof meta.pastRunCount === 'number');

    const config = await fetch(`${base}/api/benchmark/config`).then((r) => r.json());
    assert.ok(config.configPath);
    assert.equal(typeof config.provider, 'string');

    const runs = await fetch(`${base}/api/benchmark/runs`).then((r) => r.json());
    assert.ok(Array.isArray(runs.runs));

    const cases = await fetch(
      `${base}/api/benchmark/cases?suite=frontend&difficulty=easy`,
    ).then((r) => r.json());
    assert.ok(cases.total >= 1);

    const logs = await fetch(`${base}/api/benchmark/logs`).then((r) => r.json());
    assert.ok(Array.isArray(logs.logs));
    assert.equal(typeof logs.status.status, 'string');

    const status = await fetch(`${base}/api/benchmark/status`).then((r) => r.json());
    assert.equal(status.status, 'idle');

    const stop = await fetch(`${base}/api/benchmark/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).then((r) => r.json());
    assert.equal(stop.status, 'idle');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
