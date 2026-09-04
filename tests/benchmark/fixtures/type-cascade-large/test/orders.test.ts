import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrdersEntry, totalOrdersAmount } from '../src/features/orders/service.js';
import { toOrdersResponseDto } from '../src/features/orders/dto.js';

// After the Order.total migration this asserts against the flat DTO
// projection (order.total.amount), not the raw internal Order record.
test('createOrdersEntry and totalOrdersAmount track order totals', () => {
  const order = createOrdersEntry('cust-1', 100);
  assert.equal(order.customerId, 'cust-1');
  assert.equal(toOrdersResponseDto(order).total, 100);
  assert.ok(totalOrdersAmount() >= 100);
});
