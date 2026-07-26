import test from 'node:test';
import assert from 'node:assert/strict';

test('users route module exports router', async () => {
  const mod = await import('../src/routes/users.js');
  assert.ok(mod.default);
});
