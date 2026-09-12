#!/usr/bin/env node
/**
 * Real adapter: live stream-json stages survive harness SIGTERM.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const adapter = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../scripts/mitii-benchmark-agent.mjs',
);

test('mitii-benchmark-agent keeps stages then emits adapter_sigterm', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mitii-adapter-'));
  const workspace = join(root, 'ws');
  mkdirSync(workspace, { recursive: true });
  const fakeMitii = join(root, 'fake-mitii.js');
  writeFileSync(
    fakeMitii,
    `#!/usr/bin/env node
const cmd = process.argv[2];
if (cmd === 'index') {
  process.stdout.write(JSON.stringify({ ok: true }) + '\\n');
  process.exit(0);
}
if (cmd === 'ask') {
  const event = {
    type: 'event',
    event: {
      type: 'stage_started',
      stage: 'understood',
      at: new Date().toISOString(),
    },
  };
  process.stdout.write(JSON.stringify(event) + '\\n');
  setInterval(() => {}, 1 << 30);
  return;
}
process.stderr.write('unexpected ' + cmd + '\\n');
process.exit(2);
`,
  );
  chmodSync(fakeMitii, 0o755);

  const child = spawn(
    process.execPath,
    [
      adapter,
      '--mode',
      'agent',
      '--prompt',
      'noop',
      '--cwd',
      workspace,
    ],
    {
      env: { ...process.env, MITII_BIN: fakeMitii },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });

  await new Promise((resolveWait) => {
    const check = () => {
      if (stdout.includes('"stage":"understood"')) {
        resolveWait();
        return;
      }
      setTimeout(check, 20);
    };
    check();
    setTimeout(resolveWait, 2000);
  });

  child.kill('SIGTERM');
  const code = await new Promise((resolveCode) => child.on('close', resolveCode));

  assert.equal(code, 124);
  assert.match(stdout, /"stage":"adapter_index"/);
  assert.match(stdout, /"stage":"understood"/);
  assert.match(stdout, /"reason":"adapter_sigterm"/);
  assert.ok(
    stdout.indexOf('adapter_index') < stdout.indexOf('understood') &&
      stdout.indexOf('understood') < stdout.indexOf('adapter_sigterm'),
  );
});
