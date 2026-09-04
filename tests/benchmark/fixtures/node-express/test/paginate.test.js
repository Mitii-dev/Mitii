import test from 'node:test';
import assert from 'node:assert/strict';
import { paginate } from '../src/utils/paginate.js';

test('paginate returns exactly pageSize items per full page', () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.deepStrictEqual(paginate(items, 1, 3), [1, 2, 3]);
  assert.deepStrictEqual(paginate(items, 2, 3), [4, 5, 6]);
  assert.deepStrictEqual(paginate(items, 3, 3), [7, 8, 9]);
});

test('paginate returns a shorter final page without dropping its last item', () => {
  const items = [1, 2, 3, 4, 5, 6, 7];
  assert.deepStrictEqual(paginate(items, 3, 3), [7]);
});
