import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefundsEntry, totalRefundsAmount } from '../src/features/refunds/service.js';
import { toRefundsResponseDto } from '../src/features/refunds/dto.js';

// After the Order.total migration this asserts against the flat DTO
// projection (order.total.amount), not the raw internal Order record.
test('createRefundsEntry and totalRefundsAmount track order totals', () => {
  const order = createRefundsEntry('cust-1', 100);
  assert.equal(order.customerId, 'cust-1');
  assert.equal(toRefundsResponseDto(order).total, 100);
  assert.ok(totalRefundsAmount() >= 100);
});
