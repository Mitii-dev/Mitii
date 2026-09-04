import test from 'node:test';
import assert from 'node:assert/strict';
import { placeOrder, totalRevenue } from '../src/services/orderService.js';
import { toOrderResponseDto } from '../src/dto/orderResponseDto.js';

// Asserts against the flat DTO projection (order.total.amount after the
// migration), not the raw internal Order record.
test('placeOrder and totalRevenue track order totals', () => {
  const order = placeOrder('cust-1', 100);
  assert.equal(order.customerId, 'cust-1');
  assert.equal(toOrderResponseDto(order).total, 100);
  assert.ok(totalRevenue() >= 100);
});
