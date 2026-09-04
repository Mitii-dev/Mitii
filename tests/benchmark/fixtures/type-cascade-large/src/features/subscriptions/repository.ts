import type { Order } from '../../types/domain.js';

const subscriptionsStore = new Map<string, Order>();

export function saveSubscriptionsRecord(id: string, customerId: string, total: number): Order {
  const order: Order = { id, customerId, total, createdAt: new Date().toISOString() };
  subscriptionsStore.set(id, order);
  return order;
}

export function listSubscriptionsRecords(): Order[] {
  return [...subscriptionsStore.values()];
}
