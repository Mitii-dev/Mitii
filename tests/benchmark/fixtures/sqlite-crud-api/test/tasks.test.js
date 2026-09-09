import test from 'node:test';
import assert from 'node:assert/strict';

test('tasks route module exports router', async () => {
  const mod = await import('../src/routes/tasks.js');
  assert.ok(mod.default);
});

test('taskService module exports the CRUD surface', async () => {
  const mod = await import('../src/services/taskService.js');
  assert.equal(typeof mod.listTasks, 'function');
  assert.equal(typeof mod.createTask, 'function');
  assert.equal(typeof mod.getTask, 'function');
});
