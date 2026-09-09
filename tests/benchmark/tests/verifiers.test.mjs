import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
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

test('sqlite_query asserts a row/column value from a real db file', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'solid-bench-sqlite-'));
  const db = new Database(join(workspace, 'db.sqlite'));
  db.exec('CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT)');
  db.prepare('INSERT INTO tasks (title) VALUES (?)').run('write plan');
  db.close();
  const before = snapshotTree(workspace);
  const context = { output: '', agentExitCode: 0, workspace, before, after: before };

  const countCheck = await verifyCheck(
    { type: 'sqlite_query', dbPath: 'db.sqlite', sql: 'SELECT count(*) as n FROM tasks', column: 'n', equals: 1 },
    context
  );
  assert.equal(countCheck.passed, true, countCheck.details);

  const wrongCountCheck = await verifyCheck(
    { type: 'sqlite_query', dbPath: 'db.sqlite', sql: 'SELECT count(*) as n FROM tasks', column: 'n', equals: 0 },
    context
  );
  assert.equal(wrongCountCheck.passed, false);

  const missingDbCheck = await verifyCheck(
    { type: 'sqlite_query', dbPath: 'missing.sqlite', sql: 'SELECT 1', column: 'n', equals: 0 },
    context
  );
  assert.equal(missingDbCheck.passed, false);
});

test('changed_file_count enforces a min/max on the workspace diff', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'solid-bench-changed-count-'));
  writeFileSync(join(workspace, 'a.txt'), 'a\n');
  const before = snapshotTree(workspace);
  writeFileSync(join(workspace, 'a.txt'), 'a changed\n');
  writeFileSync(join(workspace, 'b.txt'), 'b\n');
  const after = snapshotTree(workspace);
  const context = { output: '', agentExitCode: 0, workspace, before, after };

  const inRange = await verifyCheck({ type: 'changed_file_count', minimum: 2, maximum: 2 }, context);
  assert.equal(inRange.passed, true, inRange.details);

  const tooFew = await verifyCheck({ type: 'changed_file_count', minimum: 5 }, context);
  assert.equal(tooFew.passed, false);

  const tooMany = await verifyCheck({ type: 'changed_file_count', maximum: 1 }, context);
  assert.equal(tooMany.passed, false);
});

test('workflow_yaml_valid checks required jobs and triggers', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'solid-bench-workflow-'));
  mkdirSync(join(workspace, '.github', 'workflows'), { recursive: true });
  writeFileSync(
    join(workspace, '.github', 'workflows', 'ci.yml'),
    'on:\n  push: {}\n  pull_request: {}\njobs:\n  build:\n    runs-on: ubuntu-latest\n  test:\n    runs-on: ubuntu-latest\n'
  );
  const before = snapshotTree(workspace);
  const context = { output: '', agentExitCode: 0, workspace, before, after: before };

  const passing = await verifyCheck(
    {
      type: 'workflow_yaml_valid',
      path: '.github/workflows/ci.yml',
      requireJobs: ['build', 'test'],
      requireTriggers: ['push', 'pull_request'],
    },
    context
  );
  assert.equal(passing.passed, true, passing.details);

  const missingJob = await verifyCheck(
    { type: 'workflow_yaml_valid', path: '.github/workflows/ci.yml', requireJobs: ['deploy'] },
    context
  );
  assert.equal(missingJob.passed, false);

  const missingFile = await verifyCheck(
    { type: 'workflow_yaml_valid', path: '.github/workflows/missing.yml', requireJobs: ['build'] },
    context
  );
  assert.equal(missingFile.passed, false);
});
