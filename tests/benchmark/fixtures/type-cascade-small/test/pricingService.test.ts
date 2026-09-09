import test from 'node:test';
import assert from 'node:assert/strict';
import { totalWithTax, isHighValue } from '../src/services/pricingService.js';
import type { Order } from '../src/types/domain.js';

test('totalWithTax applies the tax rate to the order total', () => {
  const order: Order = { id: '1', customerId: 'cust-1', total: 100, createdAt: new Date().toISOString() };
  assert.equal(totalWithTax(order, 0.1), 110);
  assert.equal(isHighValue(order), false);
});
