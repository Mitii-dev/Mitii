import type { Order } from '../types/domain.js';

const orders = new Map<string, Order>();

export function saveOrder(order: Order): Order {
  orders.set(order.id, order);
  return order;
}

export function getOrder(id: string): Order | undefined {
  return orders.get(id);
}

export function listOrders(): Order[] {
  return [...orders.values()];
}

export function createOrder(id: string, customerId: string, total: number): Order {
  const order: Order = { id, customerId, total, createdAt: new Date().toISOString() };
  return saveOrder(order);
}
