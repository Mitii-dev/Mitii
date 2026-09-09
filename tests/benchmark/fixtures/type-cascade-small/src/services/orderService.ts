import type { Order } from '../types/domain.js';
import { createOrder, listOrders } from '../repositories/orderRepository.js';
import { totalWithTax } from './pricingService.js';

let nextId = 1;

export function placeOrder(customerId: string, total: number): Order {
  const order = createOrder(String(nextId), customerId, total);
  nextId += 1;
  return order;
}

export function totalRevenue(): number {
  return listOrders().reduce((sum, order) => sum + order.total, 0);
}

export function orderWithTax(order: Order, rate: number): number {
  return totalWithTax(order, rate);
}
