import type { Order } from '../../types/domain.js';

const customersLog = new Map<string, Order>();

export function recordCustomersEvent(orderId: string, order: Order): void {
  customersLog.set(orderId, order);
}

export function getCustomersEvent(orderId: string): Order | undefined {
  return customersLog.get(orderId);
}
