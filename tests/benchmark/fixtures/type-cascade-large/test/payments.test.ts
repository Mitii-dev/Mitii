import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaymentsEntry, totalPaymentsAmount } from '../src/features/payments/service.js';
import { toPaymentsResponseDto } from '../src/features/payments/dto.js';

// After the Order.total migration this asserts against the flat DTO
// projection (order.total.amount), not the raw internal Order record.
test('createPaymentsEntry and totalPaymentsAmount track order totals', () => {
  const order = createPaymentsEntry('cust-1', 100);
  assert.equal(order.customerId, 'cust-1');
  assert.equal(toPaymentsResponseDto(order).total, 100);
  assert.ok(totalPaymentsAmount() >= 100);
});
