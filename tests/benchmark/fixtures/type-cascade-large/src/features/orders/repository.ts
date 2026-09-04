import type { Order } from '../../types/domain.js';

const ordersStore = new Map<string, Order>();

export function saveOrdersRecord(id: string, customerId: string, total: number): Order {
  const order: Order = { id, customerId, total, createdAt: new Date().toISOString() };
  ordersStore.set(id, order);
  return order;
}

export function listOrdersRecords(): Order[] {
  return [...ordersStore.values()];
}
