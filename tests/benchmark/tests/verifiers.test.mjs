import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { snapshotTree } from '../src/snapshot.mjs';
import { verifyCheck } from '../src/verifiers.mjs';

test('deterministic output and file checks pass', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'solid-bench-test-'));
  writeFileSync(join(workspace, 'result.txt'), 'expected value\n');
  const before = snapshotTree(workspace);
  const context = {
    output: 'Build command: npm run build',
    agentExitCode: 0,
    workspace,
    before,
    after: before,
  };
  assert.equal((await verifyCheck({ type: 'agent_exit', equals: 0 }, context)).passed, true);
  assert.equal((await verifyCheck({ type: 'output_contains', value: 'npm run build' }, context)).passed, true);
  assert.equal((await verifyCheck({ type: 'file_contains', path: 'result.txt', value: 'expected' }, context)).passed, true);
});

test('file_contains_any passes when any listed path has the value', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'solid-bench-any-'));
  writeFileSync(join(workspace, 'a.txt'), 'nope\n');
  writeFileSync(join(workspace, 'b.txt'), 'ListUsersDto here\n');
  const before = snapshotTree(workspace);
  const context = { output: 'ok', agentExitCode: 0, workspace, before, after: before };
  assert.equal(
    (
      await verifyCheck(
        { type: 'file_contains_any', paths: ['a.txt', 'b.txt'], value: 'ListUsersDto' },
        context
      )
    ).passed,
    true
  );
  assert.equal(
    (
      await verifyCheck(
        { type: 'file_contains_any', paths: ['a.txt', 'missing.txt'], value: 'ListUsersDto' },
        context
      )
    ).passed,
    false
  );
});

test('HTTP multi-step requests share one server process', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'solid-bench-http-multi-'));
  writeFileSync(
    join(workspace, 'server.mjs'),
    `import http from 'node:http';
const seen = new Set();
http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/signup') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const email = JSON.parse(Buffer.concat(chunks).toString()).email;
    if (seen.has(email)) {
      res.writeHead(409, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'email already registered' }));
      return;
    }
    seen.add(email);
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(process.env.PORT);
`
  );
  const before = snapshotTree(workspace);
  const checked = await verifyCheck(
    {
      type: 'http',
      start: { command: 'node server.mjs' },
      requests: [
        {
          method: 'POST',
          path: '/signup',
          json: { email: 'a@example.com' },
          expect: { status: 201 },
        },
        {
          method: 'POST',
          path: '/signup',
          json: { email: 'a@example.com' },
          expect: { status: 409, jsonSubset: { error: 'email already registered' } },
        },
      ],
      timeoutMs: 5000,
    },
    { output: '', agentExitCode: 0, workspace, before, after: before }
  );
  assert.equal(checked.passed, true, checked.details);
});

test('command check executes in the isolated workspace', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'solid-bench-command-'));
  const before = snapshotTree(workspace);
  const checked = await verifyCheck(
    { type: 'command', command: 'node -e "process.exit(0)"' },
    { output: '', agentExitCode: 0, workspace, before, after: before }
  );
  assert.equal(checked.passed, true);
});

test('HTTP check starts a server and validates the exact response', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'solid-bench-http-'));
  writeFileSync(
    join(workspace, 'server.mjs'),
    "import http from 'node:http'; http.createServer((_req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,value:42}));}).listen(process.env.PORT);\n"
  );
  const before = snapshotTree(workspace);
  const checked = await verifyCheck(
    {
      type: 'http',
      start: { command: 'node server.mjs' },
      request: { method: 'GET', path: '/health' },
      expect: { status: 200, jsonSubset: { ok: true }, jsonPaths: ['value'] },
      timeoutMs: 5000,
    },
    { output: '', agentExitCode: 0, workspace, before, after: before }
  );
  assert.equal(checked.passed, true, checked.details);
});
