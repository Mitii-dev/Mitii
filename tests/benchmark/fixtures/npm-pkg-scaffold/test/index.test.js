import test from 'node:test';
import assert from 'node:assert/strict';
import { add, clamp } from '../dist/index.js';

test('add and clamp behave correctly', () => {
  assert.equal(add(2, 3), 5);
  assert.equal(clamp(10, 0, 5), 5);
  assert.equal(clamp(-10, 0, 5), 0);
});
