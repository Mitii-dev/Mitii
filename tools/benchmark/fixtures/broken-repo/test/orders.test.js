const test = require('node:test');
const assert = require('node:assert');
const { reserveStock } = require('../src/routes/orders');

test('reserves stock when quantity exactly matches available stock', () => {
  const item = { stock: 5 };
  const result = reserveStock(item, 5);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.remaining, 0);
});

test('rejects reservation when quantity exceeds stock', () => {
  const item = { stock: 3 };
  const result = reserveStock(item, 4);
  assert.strictEqual(result.ok, false);
});
