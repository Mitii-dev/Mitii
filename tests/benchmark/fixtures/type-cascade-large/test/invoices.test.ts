import test from 'node:test';
import assert from 'node:assert/strict';
import { createInvoicesEntry, totalInvoicesAmount } from '../src/features/invoices/service.js';
import { toInvoicesResponseDto } from '../src/features/invoices/dto.js';

// After the Order.total migration this asserts against the flat DTO
// projection (order.total.amount), not the raw internal Order record.
test('createInvoicesEntry and totalInvoicesAmount track order totals', () => {
  const order = createInvoicesEntry('cust-1', 100);
  assert.equal(order.customerId, 'cust-1');
  assert.equal(toInvoicesResponseDto(order).total, 100);
  assert.ok(totalInvoicesAmount() >= 100);
});
