import type { Order } from '../types/domain.js';
import { applyTax } from '../utils/currency.js';

export function totalWithTax(order: Order, rate: number): number {
  return applyTax(order.total, rate);
}

export function isHighValue(order: Order): boolean {
  return order.total > 500;
}

export function compareOrders(a: Order, b: Order): number {
  return a.total - b.total;
}
