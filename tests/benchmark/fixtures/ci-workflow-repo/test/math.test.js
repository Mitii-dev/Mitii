import test from 'node:test';
import assert from 'node:assert/strict';
import { add, isEven } from '../src/math.js';

test('add and isEven behave correctly', () => {
  assert.equal(add(2, 3), 5);
  assert.equal(isEven(4), true);
  assert.equal(isEven(5), false);
});
